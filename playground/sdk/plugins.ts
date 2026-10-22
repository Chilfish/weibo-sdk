import type {
  FetchLike,
  FetchResponseLike,
  TransportResponse,
  WeiboPlugin,
  WeiboSDKTelemetry,
} from '@chilfish/weibo-sdk'
import type { SdkScenario } from '../lib/types'
import { fetchTransport, WeiboSDK } from '@chilfish/weibo-sdk'

const UID = '1111681197'

const USER_OK = {
  ok: 1,
  data: {
    user: {
      id: 1111681197,
      idstr: UID,
      screen_name: 'playground-user',
      followers_count: 42,
      description: 'plugin / transport demo',
    },
  },
}

/** 最小 fetch 响应：JSON 文本 + 小写 header 读取。 */
function jsonResponse(status: number, body: unknown): FetchResponseLike {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      getSetCookie: () => [],
    },
    text: async () => JSON.stringify(body),
  }
}

/** 脚本化 fetch：第 1 次 432（演示重试），之后返回合法用户资料。 */
function createScriptedFetch(): { fetch: FetchLike, calls: string[] } {
  const calls: string[] = []
  let count = 0
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url)
    count += 1
    if (count === 1)
      return jsonResponse(432, { ok: 0, message: 'playground rate limit' })
    return jsonResponse(200, USER_OK)
  }
  return { fetch: fetchImpl, calls }
}

/** 纯离线：自定义 fetch transport + transport 中间件 + 生命周期 hooks + observer。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'plugins',
  title: '插件 / 自定义 transport（离线）',
  summary: 'fetchTransport + 缓存中间件 + beforeRequest / afterResponse / beforeRetry / onError / observe',
  usage: 'pnpm play plugins',
  requiresCookie: false,
  async run({ log }) {
    const scripted = createScriptedFetch()
    const cache = new Map<string, TransportResponse>()
    const observed: string[] = []
    const retries: string[] = []
    const responses: string[] = []
    const headersSeen: Record<string, string>[] = []
    const telemetryEvents: Array<Record<string, unknown>> = []
    let cacheHits = 0

    const telemetry: WeiboSDKTelemetry = {
      emit(event) {
        telemetryEvents.push(event as unknown as Record<string, unknown>)
      },
    }

    // enforce: 'pre' 的 transport 中间件位于最外层，适合做缓存 / 熔断 / 签名。
    const cachePlugin: WeiboPlugin = {
      name: 'playground-cache',
      apiVersion: 1,
      enforce: 'pre',
      transport: next => ({
        async send(request) {
          const key = `${request.method} ${request.url} ${JSON.stringify(request.query ?? {})}`
          const hit = cache.get(key)
          if (hit) {
            cacheHits += 1
            return hit
          }
          const response = await next.send(request)
          if (response.status === 200)
            cache.set(key, response)
          return response
        },
      }),
    }

    const hooksPlugin: WeiboPlugin = {
      name: 'playground-hooks',
      apiVersion: 1,
      enforce: 'normal',
      hooks: {
        beforeRequest(context) {
          context.headers['x-playground-plugin'] = 'on'
          headersSeen.push({ ...context.headers })
        },
        afterResponse(context) {
          responses.push(`status=${context.status} bytes=${JSON.stringify(context.data).length}`)
        },
        beforeRetry(context) {
          retries.push(`attempt=${context.attempt} reason=${context.reason} ${context.delayMs}ms → 0ms`)
          // 演示改延迟；返回 { retry: false } 可以直接终止重试。
          return { delayMs: 0 }
        },
      },
      observe(event) {
        observed.push(event.event_name)
      },
    }

    const sdk = new WeiboSDK({
      cookie: 'SUB=playground; SUBP=playground',
      auth: 'cookie',
      selfCheck: { mode: 'none' },
      retry: { retries: 1, baseDelayMs: 50, maxDelayMs: 50 },
      transport: fetchTransport({ fetch: scripted.fetch }),
      plugins: [hooksPlugin, cachePlugin],
      telemetry,
    })

    log.heading('第 1 次请求：432 → 插件改延迟 → 重试成功')
    const first = await sdk.users.getById(UID)
    log.kv('user', first.name)

    log.heading('第 2 次请求：命中 transport 缓存，不再调用 fetch')
    const second = await sdk.users.getById(UID)
    log.kv('sameUser', second.name)

    log.heading('插件观测结果')
    log.kv('fetchCalls', scripted.calls.length)
    log.kv('cacheHits', cacheHits)
    log.kv('observedEvents', [...new Set(observed)])
    log.kv('retryDecisions', retries)
    log.kv('afterResponse', responses)
    log.kv('pluginHeaderSeen', headersSeen[0]?.['x-playground-plugin'])
    log.kv('credentialId', telemetryEvents.find(event => event.event_name === 'request_start')?.credential_id)

    log.heading('onError：把上游错误替换成业务错误')
    const failingTransport = fetchTransport({
      fetch: async () => jsonResponse(500, { ok: 0, message: 'upstream exploded' }),
    })
    const replaceError: WeiboPlugin = {
      name: 'playground-error',
      apiVersion: 1,
      hooks: {
        onError() {
          return new Error('playground: upstream 500 converted to a domain error')
        },
      },
    }
    const failingSdk = new WeiboSDK({
      cookie: 'SUB=playground',
      auth: 'cookie',
      selfCheck: { mode: 'none' },
      retry: { retries: 0 },
      transport: failingTransport,
      plugins: [replaceError],
    })

    try {
      await failingSdk.users.getById(UID)
      log.warn('预期失败，但请求成功了；请检查上游行为。')
    }
    catch (error) {
      log.kv('replacedError', error instanceof Error ? error.message : String(error))
    }

    log.heading('下一步')
    log.info('插件契约：website/reference/plugins.md（https://weibo-sdk.chilfish.top/reference/plugins）')
    log.info('同一套 API 也适用于 Worker / Edge：new WeiboSDK({ transport: fetchTransport({ fetch: myFetch }) })')
    log.info('插件必须在构造期传入，不支持热插拔；observe 抛错不会影响请求。')
  },
}
