import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import type { IRequestResource } from '~/services/internal/FetcherService'
import type { ResponseContext, WeiboPlugin } from '~/services/internal/plugins'
import type { IWeiboConfig } from '~/types/config'
import { createFakeAxios, FakeClock, NoopRateLimitService, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { NetworkRequestError, RateLimitError } from '~/models/errors/TransportError'
import { userInfoSpec } from '~/services/endpoints/user'
import { FetcherService } from '~/services/internal/FetcherService'

class TestFetcherService extends FetcherService {
  public async get<T>(resource: IRequestResource, args?: Record<string, unknown>): Promise<T> {
    return this.fetch<T>(resource, args)
  }

  public async callUser(uid: string): Promise<unknown> {
    return this.request(userInfoSpec, { uid })
  }
}

const RESOURCE: IRequestResource = { method: 'GET', url: 'https://weibo.com/ajax/test' }

const USER_OK = {
  ok: 1,
  data: { user: { id: 1, idstr: '1', screen_name: 'target' } },
}

interface FakeAxiosResponse {
  data?: unknown
  status?: number
  headers?: Record<string, string>
}

/**
 * 需要控制 `status` / `headers` 的 axios 替身（testkit 的 `createFakeAxios` 只回 `data`）。
 */
function createStatusAxios(handler: (config: AxiosRequestConfig) => FakeAxiosResponse | Promise<FakeAxiosResponse>) {
  let calls = 0
  let lastConfig: AxiosRequestConfig | undefined

  const client = {
    interceptors: {
      request: { use() { return 0 } },
      response: { use() { return 0 }, eject() {}, clear() {} },
    },
    async request(config: AxiosRequestConfig) {
      calls += 1
      lastConfig = config
      const response = await handler(config)
      return {
        data: response.data,
        status: response.status ?? 200,
        statusText: 'OK',
        headers: response.headers ?? {},
        config,
      }
    },
  } as unknown as AxiosInstance

  return {
    client,
    getCalls: () => calls,
    getLastConfig: () => lastConfig,
  }
}

/** 构造 axios 形态的 HTTP 错误（`isAxiosError` + `response.status/headers`）。 */
function fakeAxiosError(status: number, options: { headers?: Record<string, string>, data?: unknown } = {}): Error {
  const error = new Error(`HTTP ${status}`) as Error & Record<string, unknown>
  error.isAxiosError = true
  error.response = {
    status,
    data: options.data ?? { ok: 0, message: 'rate limited' },
    headers: options.headers ?? {},
  }
  return error
}

function createFetcher(config: Omit<IWeiboConfig, 'cookie'>, client: AxiosInstance) {
  const clock = new FakeClock()
  const telemetry = new TelemetryCollector()
  const fetcher = new TestFetcherService(
    { cookie: 'SUB=abc', telemetry, ...config },
    {
      client,
      rateLimitService: new NoopRateLimitService() as any,
      clock,
      telemetry,
    },
  )
  return { fetcher, clock, telemetry }
}

describe('fetcherService plugins: wiring', () => {
  it('compiles config.plugins automatically in the constructor', async () => {
    const observed: string[] = []
    const auto: WeiboPlugin = {
      name: 'auto',
      apiVersion: 1,
      hooks: {
        beforeRequest: () => {
          observed.push('before_request')
        },
      },
      observe: (event) => {
        observed.push(event.event_name)
      },
    }

    const { client, getLastConfig } = createFakeAxios(async () => ({ ok: 1 }))
    // 不传 deps.pipeline：必须由 config.plugins 自动编译
    const { fetcher } = createFetcher({ plugins: [auto] }, client)

    await fetcher.get(RESOURCE, { uid: '1' })

    expect(observed).toEqual(['request_start', 'before_request'])
    expect(getLastConfig()?.headers?.referer).toBe('https://weibo.com/')
  })

  it('leaves behavior unchanged when no plugins are configured', async () => {
    const { client, getLastConfig } = createFakeAxios(async () => USER_OK)
    const { fetcher, clock, telemetry } = createFetcher({}, client)

    await expect(fetcher.callUser('1')).resolves.toEqual(USER_OK)

    expect(getLastConfig()?.headers?.cookie).toContain('SUB=abc')
    expect(clock.sleepCalls).toEqual([])
    expect(telemetry.byName('request_success')).toHaveLength(1)
  })
})

describe('fetcherService plugins: hooks', () => {
  it('lets beforeRequest mutate headers and query before the transport sees them', async () => {
    const mutate: WeiboPlugin = {
      name: 'mutate',
      apiVersion: 1,
      hooks: {
        beforeRequest: (context) => {
          context.headers['x-plugin'] = 'on'
          context.query = { ...context.query, plugin: '1' }
        },
      },
    }

    const { client, getLastConfig } = createFakeAxios(async () => ({ ok: 1 }))
    const { fetcher } = createFetcher({ plugins: [mutate] }, client)

    await fetcher.get(RESOURCE, { uid: '1' })

    const config = getLastConfig()
    expect(config?.headers?.['x-plugin']).toBe('on')
    expect(config?.params).toEqual({ uid: '1', plugin: '1' })
  })

  it('lets a transport middleware short-circuit with a synthetic response', async () => {
    let axiosCalls = 0
    const mock: WeiboPlugin = {
      name: 'mock',
      apiVersion: 1,
      transport: () => ({
        async send(request) {
          expect(request.meta.attempt).toBe(1)
          return { status: 200, headers: {}, data: { ok: 1, mocked: true } }
        },
      }),
    }

    const { client } = createFakeAxios(async () => {
      axiosCalls += 1
      return { ok: 1 }
    })
    const { fetcher } = createFetcher({ plugins: [mock] }, client)

    await expect(fetcher.get(RESOURCE)).resolves.toEqual({ ok: 1, mocked: true })
    expect(axiosCalls).toBe(0)
  })

  it('treats a throwing lifecycle hook as fatal and does not send the request', async () => {
    let axiosCalls = 0
    const fatal: WeiboPlugin = {
      name: 'fatal',
      apiVersion: 1,
      hooks: {
        beforeRequest: () => {
          throw new Error('plugin rejected the request')
        },
      },
    }

    const { client } = createFakeAxios(async () => {
      axiosCalls += 1
      return { ok: 1 }
    })
    const { fetcher } = createFetcher({ plugins: [fatal] }, client)

    await expect(fetcher.get(RESOURCE)).rejects.toThrow('plugin rejected the request')
    expect(axiosCalls).toBe(0)
  })

  it('delivers status / responseHeaders / data to afterResponse before okPolicy', async () => {
    const seen: ResponseContext[] = []
    const inspector: WeiboPlugin = {
      name: 'inspector',
      apiVersion: 1,
      hooks: {
        afterResponse: (context) => {
          seen.push({ ...context })
        },
      },
    }

    const { client } = createStatusAxios(() => ({
      status: 200,
      headers: { 'X-Rate-Left': '42', 'Content-Type': 'application/json' },
      data: { ok: 0, message: 'not ok' },
    }))
    const { fetcher } = createFetcher({ plugins: [inspector], retry: { retries: 0 } }, client)

    // okPolicy 判定失败，但 afterResponse 已经拿到完整响应
    await expect(fetcher.callUser('1')).rejects.toBeInstanceOf(WeiboAPINotOkError)

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      status: 200,
      endpoint: 'ajax/profile/info',
      resourceType: 'USER_INFO',
      data: { ok: 0, message: 'not ok' },
    })
    expect(seen[0].responseHeaders['x-rate-left']).toBe('42')
    // 请求头与响应头分开交付
    expect(seen[0].headers.cookie).toContain('SUB=abc')
    expect(seen[0].headers['x-rate-left']).toBeUndefined()
  })

  it('passes a 432 through afterResponse and then surfaces RateLimitError', async () => {
    const statuses: number[] = []
    const inspector: WeiboPlugin = {
      name: 'inspector',
      apiVersion: 1,
      hooks: {
        afterResponse: (context) => {
          statuses.push(context.status)
        },
      },
    }

    const { client } = createFakeAxios(async () => {
      throw fakeAxiosError(432)
    })
    const { fetcher } = createFetcher({ plugins: [inspector], retry: { retries: 0 } }, client)

    await expect(fetcher.callUser('1')).rejects.toBeInstanceOf(RateLimitError)
    expect(statuses).toEqual([432])
  })

  it('lets onError replace the terminal error', async () => {
    const replacement = new Error('replaced by plugin')
    let phase: string | undefined
    const replacer: WeiboPlugin = {
      name: 'replacer',
      apiVersion: 1,
      hooks: {
        onError: (context) => {
          phase = context.phase
          return replacement
        },
      },
    }

    const { client } = createStatusAxios(() => ({ status: 500, data: { ok: 0 } }))
    const { fetcher } = createFetcher({ plugins: [replacer], retry: { retries: 0 } }, client)

    await expect(fetcher.get(RESOURCE)).rejects.toBe(replacement)
    expect(phase).toBe('request')

    // 未安装插件时同一响应仍映射为 NetworkRequestError（证明是插件替换了错误）
    const { client: plainClient } = createStatusAxios(() => ({ status: 500, data: { ok: 0 } }))
    const plain = createFetcher({ retry: { retries: 0 } }, plainClient)
    await expect(plain.fetcher.get(RESOURCE)).rejects.toBeInstanceOf(NetworkRequestError)
  })

  it('lets beforeRetry override the backoff delay', async () => {
    const delays: number[] = []
    const faster: WeiboPlugin = {
      name: 'faster',
      apiVersion: 1,
      hooks: {
        beforeRetry: (context) => {
          delays.push(context.delayMs)
          return { delayMs: 777 }
        },
      },
    }

    let calls = 0
    const { client } = createFakeAxios(async () => {
      calls += 1
      if (calls === 1)
        throw fakeAxiosError(432)
      return { ok: 1 }
    })
    const { fetcher, clock } = createFetcher({
      plugins: [faster],
      retry: { retries: 2, baseDelayMs: 100, maxDelayMs: 1000 },
    }, client)

    await expect(fetcher.get(RESOURCE)).resolves.toEqual({ ok: 1 })

    expect(calls).toBe(2)
    expect(clock.sleepCalls).toEqual([777])
    expect(delays).toHaveLength(1)
    expect(delays[0]).toBeGreaterThanOrEqual(50)
    expect(delays[0]).toBeLessThanOrEqual(100)
  })

  it('lets beforeRetry stop the retry immediately', async () => {
    let calls = 0
    const stop: WeiboPlugin = {
      name: 'stop',
      apiVersion: 1,
      hooks: {
        beforeRetry: () => ({ retry: false }),
      },
    }

    const { client } = createFakeAxios(async () => {
      calls += 1
      throw fakeAxiosError(432)
    })
    const { fetcher, clock } = createFetcher({
      plugins: [stop],
      retry: { retries: 2, baseDelayMs: 100, maxDelayMs: 1000 },
    }, client)

    await expect(fetcher.get(RESOURCE)).rejects.toBeInstanceOf(RateLimitError)
    expect(calls).toBe(1)
    expect(clock.sleepCalls).toEqual([])
  })

  it('broadcasts request_start / request_success to observers without letting a throwing observer break the request', async () => {
    const events: string[] = []
    const boom: WeiboPlugin = {
      name: 'boom',
      apiVersion: 1,
      observe: () => {
        throw new Error('observer exploded')
      },
    }
    const recorder: WeiboPlugin = {
      name: 'recorder',
      apiVersion: 1,
      observe: (event) => {
        events.push(event.event_name)
      },
    }

    const { client } = createFakeAxios(async () => USER_OK)
    const { fetcher } = createFetcher({ plugins: [boom, recorder] }, client)

    await expect(fetcher.callUser('1')).resolves.toEqual(USER_OK)
    expect(events).toEqual(['request_start', 'request_success'])
  })
})
