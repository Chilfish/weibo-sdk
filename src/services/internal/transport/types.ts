import type { IResourceType } from '~/types/resources'

/** Transport 支持的 HTTP 方法（与 `IRequestResource` 一致）。 */
export type TransportMethod = 'GET' | 'POST'

/** 每次尝试的元信息（供 transport / 插件诊断，不参与签名）。 */
export interface TransportRequestMeta {
  endpoint?: string
  resourceType?: IResourceType
  attempt: number
  traceId: string
  authMode: 'cookie' | 'guest'
  credentialId?: string
}

/**
 * 传输层请求契约。
 *
 * - `headers` 的键统一小写；每次重试由 `FetcherService` 构造新对象，transport 不得修改入参。
 * - `proxy` 为已解析的代理 URL；`false` 表示显式直连；`undefined` 表示交给 transport 默认行为。
 * - `redirect: 'manual'` 必须把 3xx 作为正常响应返回（guest 登录页 / visitor 入口判定依赖它）。
 */
export interface TransportRequest {
  method: TransportMethod
  url: string
  headers: Record<string, string>
  query?: Record<string, unknown>
  body?: Record<string, unknown>
  timeoutMs: number
  redirect: 'follow' | 'manual'
  signal?: AbortSignal
  proxy?: string | false
  meta: TransportRequestMeta
}

/** 传输层响应契约：所有 HTTP 状态码都正常返回。 */
export interface TransportResponse {
  status: number
  /** header 名统一小写；`set-cookie` 等可能为数组。 */
  headers: Record<string, string | string[] | undefined>
  /** JSON 已解析；非 JSON（登录页 / 风控页）返回文本。 */
  data: unknown
  url?: string
}

/** 可替换的 HTTP 传输实现。 */
export interface WeiboTransport {
  send: (request: TransportRequest) => Promise<TransportResponse>
}

/** 传输层失败类别：HTTP 语义不在这里，只表达「没拿到响应」。 */
export type TransportFailureKind = 'timeout' | 'network'

/**
 * 传输层失败（network / timeout）。
 *
 * HTTP 状态码（432 / 429 / 403 / 3xx / 登录页）由 `FetcherService` 分类，
 * transport 只负责把「没有响应」的失败包装成本类型。
 */
export class TransportFailure extends Error {
  public readonly kind: TransportFailureKind

  constructor(kind: TransportFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TransportFailure'
    this.kind = kind
  }
}

/** 最小 fetch 响应契约（避免依赖 DOM lib）。 */
export interface FetchResponseLike {
  status: number
  ok?: boolean
  url?: string
  headers: {
    get: (name: string) => string | null
    getSetCookie?: () => string[]
    forEach?: (callback: (value: string, key: string) => void) => void
  }
  text: () => Promise<string>
}

/** 最小 fetch 契约；`GuestTokenService` 与 `FetchTransport` 共用同一注入点。 */
export type FetchLike = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    redirect?: 'follow' | 'error' | 'manual'
    signal?: AbortSignal
  },
) => Promise<FetchResponseLike>

/** 读取全局 fetch；不存在的运行时返回 `undefined`。 */
export function getGlobalFetch(): FetchLike | undefined {
  const impl = (globalThis as typeof globalThis & { fetch?: unknown }).fetch
  return typeof impl === 'function' ? impl as FetchLike : undefined
}
