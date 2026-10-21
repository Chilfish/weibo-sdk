import type {
  ErrorContext,
  RequestContext,
  ResponseContext,
  RetryContext,
  WeiboEvent,
  WeiboPlugin,
} from '~/services/internal/plugins'
import type { TransportRequest, WeiboTransport } from '~/services/internal/transport'
import { describe, expect, it } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { createPluginPipeline } from '~/services/internal/plugins'

const baseTransport: WeiboTransport = {
  async send() {
    return { status: 200, headers: {}, data: 'base' }
  },
}

const request: TransportRequest = {
  method: 'GET',
  url: 'https://weibo.com/ajax/test',
  headers: {},
  timeoutMs: 1000,
  redirect: 'follow',
  meta: { attempt: 1, traceId: 'trace-1', authMode: 'cookie' },
}

const lifecycleEvent: WeiboEvent = {
  event_name: 'sdk_init',
  timestamp: 1_700_000_000_000,
  trace_id: 'trace-1',
}

function plugin(name: string, overrides: Partial<WeiboPlugin> = {}): WeiboPlugin {
  return { name, apiVersion: 1, ...overrides }
}

function requestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    method: 'GET',
    url: 'https://weibo.com/ajax/test',
    headers: { cookie: 'SUB=abc' },
    query: { uid: '1' },
    endpoint: 'ajax/test',
    resourceType: 'USER_INFO',
    attempt: 1,
    traceId: 'trace-1',
    authMode: 'cookie',
    credentialId: 'cookie-primary',
    ...overrides,
  }
}

function responseContext(overrides: Partial<ResponseContext> = {}): ResponseContext {
  return {
    ...requestContext(),
    status: 200,
    responseHeaders: { 'content-type': 'application/json' },
    data: { ok: 1 },
    durationMs: 5,
    ...overrides,
  }
}

function retryContext(overrides: Partial<RetryContext> = {}): RetryContext {
  return {
    ...requestContext(),
    maxAttempts: 3,
    reason: 'rate_limit',
    delayMs: 500,
    retry: true,
    error: new Error('rate limited'),
    ...overrides,
  }
}

function errorContext(overrides: Partial<ErrorContext> = {}): ErrorContext {
  return {
    ...requestContext(),
    phase: 'request',
    error: new Error('boom'),
    ...overrides,
  }
}

/** 捕获同步抛错（断言 code 等字段，比 toThrow 更精确）。 */
function captureSync(run: () => void): unknown {
  try {
    run()
  }
  catch (error) {
    return error
  }
  return undefined
}

describe('plugin pipeline: identity & validation', () => {
  it('returns an identity pipeline for [] / undefined', async () => {
    for (const plugins of [[], undefined] as const) {
      const pipeline = createPluginPipeline(plugins)

      expect(pipeline.plugins).toEqual([])
      expect(pipeline.hasHooks).toBe(false)
      expect(pipeline.wrapTransport(baseTransport)).toBe(baseTransport)

      await expect(pipeline.beforeRequest(requestContext())).resolves.toBeUndefined()
      await expect(pipeline.afterResponse(responseContext())).resolves.toBeUndefined()
      await expect(pipeline.beforeRetry(retryContext())).resolves.toEqual({ retry: true, delayMs: 500 })

      const failure = new Error('boom')
      await expect(pipeline.onError(errorContext({ error: failure }))).resolves.toBe(failure)

      expect(() => pipeline.observe(lifecycleEvent)).not.toThrow()
    }
  })

  it('reuses the shared empty pipeline (no allocation on the hot path)', () => {
    expect(createPluginPipeline([])).toBe(createPluginPipeline(undefined))
  })

  it('does not count observers as hooks', () => {
    const pipeline = createPluginPipeline([plugin('observer-only', { observe: () => {} })])

    expect(pipeline.hasHooks).toBe(false)
    expect(pipeline.wrapTransport(baseTransport)).toBe(baseTransport)
  })

  it('rejects duplicate plugin names with CONFIG_INVALID', () => {
    const error = captureSync(() => createPluginPipeline([plugin('dup'), plugin('dup')]))

    expect(error).toBeInstanceOf(InvalidConfigError)
    expect((error as InvalidConfigError).code).toBe('CONFIG_INVALID')
    expect((error as InvalidConfigError).message).toContain('dup')
  })

  it('rejects an unsupported apiVersion with CONFIG_INVALID', () => {
    const error = captureSync(() => createPluginPipeline([
      plugin('future', { apiVersion: 2 as unknown as 1 }),
    ]))

    expect(error).toBeInstanceOf(InvalidConfigError)
    expect((error as InvalidConfigError).code).toBe('CONFIG_INVALID')
    expect((error as InvalidConfigError).message).toContain('apiVersion')
  })

  it('rejects a plugin without a name', () => {
    const error = captureSync(() => createPluginPipeline([{ apiVersion: 1 } as WeiboPlugin]))

    expect(error).toBeInstanceOf(InvalidConfigError)
  })
})

describe('plugin pipeline: ordering', () => {
  it('runs pre → normal → post, keeping registration order inside a group', async () => {
    const order: string[] = []
    const record = (name: string, enforce?: 'pre' | 'normal' | 'post'): WeiboPlugin => plugin(`plugin-${name}`, {
      ...(enforce === undefined ? {} : { enforce }),
      hooks: {
        beforeRequest: () => {
          order.push(`request:${name}`)
        },
        afterResponse: () => {
          order.push(`response:${name}`)
        },
        beforeRetry: () => {
          order.push(`retry:${name}`)
        },
      },
    })

    // 故意按 post → normal → pre 注册
    const pipeline = createPluginPipeline([
      record('post', 'post'),
      record('normal-a', 'normal'),
      record('normal-b', 'normal'),
      record('pre', 'pre'),
    ])

    expect(pipeline.plugins.map(item => item.name)).toEqual([
      'plugin-pre',
      'plugin-normal-a',
      'plugin-normal-b',
      'plugin-post',
    ])
    expect(pipeline.hasHooks).toBe(true)

    await pipeline.beforeRequest(requestContext())
    await pipeline.afterResponse(responseContext())
    await pipeline.beforeRetry(retryContext())

    const expected = ['pre', 'normal-a', 'normal-b', 'post']
    expect(order).toEqual([
      ...expected.map(name => `request:${name}`),
      ...expected.map(name => `response:${name}`),
      ...expected.map(name => `retry:${name}`),
    ])
  })
})

describe('plugin pipeline: beforeRetry', () => {
  it('applies a delay override', async () => {
    const pipeline = createPluginPipeline([
      plugin('slow', {
        hooks: {
          beforeRetry: () => ({ delayMs: 1234 }),
        },
      }),
    ])

    await expect(pipeline.beforeRetry(retryContext({ delayMs: 500 })))
      .resolves
      .toEqual({ retry: true, delayMs: 1234 })
  })

  it('lets a hook stop the retry', async () => {
    const pipeline = createPluginPipeline([
      plugin('give-up', {
        hooks: {
          beforeRetry: () => ({ retry: false }),
        },
      }),
    ])

    await expect(pipeline.beforeRetry(retryContext({ delayMs: 500 })))
      .resolves
      .toEqual({ retry: false, delayMs: 500 })
  })

  it('passes prior hook results to later hooks', async () => {
    const seen: Array<{ retry: boolean, delayMs: number }> = []
    const pipeline = createPluginPipeline([
      plugin('first', {
        hooks: {
          beforeRetry: () => ({ delayMs: 42 }),
        },
      }),
      plugin('second', {
        hooks: {
          beforeRetry: (context) => {
            seen.push({ retry: context.retry, delayMs: context.delayMs })
            return { retry: false }
          },
        },
      }),
    ])

    await expect(pipeline.beforeRetry(retryContext({ delayMs: 500 })))
      .resolves
      .toEqual({ retry: false, delayMs: 42 })
    expect(seen).toEqual([{ retry: true, delayMs: 42 }])
  })
})

describe('plugin pipeline: onError', () => {
  it('lets a later hook replace the error', async () => {
    const seen: unknown[] = []
    const pipeline = createPluginPipeline([
      plugin('first', {
        hooks: {
          onError: () => new Error('first'),
        },
      }),
      plugin('second', {
        hooks: {
          onError: (context) => {
            seen.push(context.error)
            return new Error('second')
          },
        },
      }),
    ])

    const original = new Error('original')
    const result = await pipeline.onError(errorContext({ error: original }))

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('second')
    expect((seen[0] as Error).message).toBe('first')
  })

  it('keeps the current error when a hook returns void', async () => {
    const pipeline = createPluginPipeline([
      plugin('noop', { hooks: { onError: () => {} } }),
    ])

    const original = new Error('original')
    await expect(pipeline.onError(errorContext({ error: original }))).resolves.toBe(original)
  })
})

describe('plugin pipeline: observe', () => {
  it('swallows a throwing observer and still calls the rest', () => {
    const received: WeiboEvent[] = []
    const pipeline = createPluginPipeline([
      plugin('boom', {
        observe: () => {
          throw new Error('observer exploded')
        },
      }),
      plugin('recorder', {
        observe: (event) => {
          received.push(event)
        },
      }),
    ])

    expect(() => pipeline.observe(lifecycleEvent)).not.toThrow()
    expect(received).toEqual([lifecycleEvent])
  })

  it('does not produce an unhandled rejection for a rejected async observer', async () => {
    const received: string[] = []
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }

    const pipeline = createPluginPipeline([
      plugin('async-boom', {
        async observe() {
          throw new Error('async observer exploded')
        },
      }),
      plugin('recorder', {
        async observe(event) {
          received.push(event.event_name)
        },
      }),
    ])

    process.on('unhandledRejection', onUnhandled)
    try {
      pipeline.observe(lifecycleEvent)
      // 让被吞掉的 rejection 有机会被检测（若未 catch 就会出现在 unhandled 里）
      await new Promise(resolve => setImmediate(resolve))
    }
    finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(unhandled).toEqual([])
    expect(received).toEqual(['sdk_init'])
  })
})

describe('plugin pipeline: wrapTransport', () => {
  it('returns the base transport when no middleware is registered', () => {
    const pipeline = createPluginPipeline([
      plugin('hooks-only', { hooks: { beforeRequest: () => {} } }),
    ])

    expect(pipeline.wrapTransport(baseTransport)).toBe(baseTransport)
  })

  it('composes middlewares in order when driving a request', async () => {
    const calls: string[] = []
    const middleware = (name: string) => (next: WeiboTransport): WeiboTransport => ({
      async send(request) {
        calls.push(`${name}:in`)
        const response = await next.send(request)
        calls.push(`${name}:out`)
        return response
      },
    })

    const pipeline = createPluginPipeline([
      plugin('post-plugin', { enforce: 'post', transport: middleware('post') }),
      plugin('pre-plugin', { enforce: 'pre', transport: middleware('pre') }),
      plugin('normal-plugin', { transport: middleware('normal') }),
    ])

    const wrapped = pipeline.wrapTransport(baseTransport)

    expect(wrapped).not.toBe(baseTransport)
    await expect(wrapped.send(request)).resolves.toEqual({ status: 200, headers: {}, data: 'base' })

    // 排序靠前的插件位于最外层：请求进入 pre → normal → post，退出时反向
    expect(calls).toEqual([
      'pre:in',
      'normal:in',
      'post:in',
      'post:out',
      'normal:out',
      'pre:out',
    ])
  })

  it('forwards the request object and response unchanged when middlewares only observe', async () => {
    const seen: TransportRequest[] = []
    const pipeline = createPluginPipeline([
      plugin('spy', {
        transport: next => ({
          async send(request) {
            seen.push(request)
            return next.send(request)
          },
        }),
      }),
    ])

    const wrapped = pipeline.wrapTransport(baseTransport)
    const response = await wrapped.send(request)

    expect(seen).toEqual([request])
    expect(response).toEqual({ status: 200, headers: {}, data: 'base' })
  })
})
