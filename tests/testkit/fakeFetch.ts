import type { FetchLike, FetchResponseLike } from '~/services/internal/transport'

/** 传给注入 fetch 的 init（与 `FetchTransport` 实际构造的形状一致）。 */
export interface FakeFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  redirect?: 'follow' | 'error' | 'manual'
  signal?: AbortSignal
}

export interface FakeFetchCall {
  url: string
  init: FakeFetchInit
}

export type FakeFetchHandler = (
  url: string,
  init: FakeFetchInit,
) => FetchResponseLike | Promise<FetchResponseLike>

export interface FakeFetch {
  fetch: FetchLike
  /** 所有调用（含 url 与 init），按调用顺序。 */
  getCalls: () => FakeFetchCall[]
  /** 最后一次调用的 init；未调用时为 `undefined`。 */
  getLastInit: () => FakeFetchInit | undefined
}

/**
 * fetch 替身：把调用记录下来并交给 handler 决定响应 / 抛错。
 *
 * handler 可返回 `fakeFetchResponse(...)`，也可直接抛错（模拟超时 / 网络失败）。
 */
export function createFakeFetch(handler: FakeFetchHandler): FakeFetch {
  const calls: FakeFetchCall[] = []

  const fetchImpl: FetchLike = async (url, init) => {
    const normalized: FakeFetchInit = { ...(init ?? {}) }
    calls.push({ url, init: normalized })
    return handler(url, normalized)
  }

  return {
    fetch: fetchImpl,
    getCalls: () => calls,
    getLastInit: () => calls.at(-1)?.init,
  }
}

export interface FakeFetchResponseOptions {
  status?: number
  /** 字符串原样返回；其它值 `JSON.stringify` 后返回；缺省为空文本。 */
  body?: unknown
  /** 响应头（大小写不敏感读取；附带注入 `forEach`）。 */
  headers?: Record<string, string>
  /** 多值 `Set-Cookie`（通过 `getSetCookie()` 读取）。 */
  setCookies?: string[]
  url?: string
}

/**
 * 构造最小 `FetchResponseLike`：header 读取大小写不敏感，支持 `getSetCookie`。
 */
export function fakeFetchResponse(options: FakeFetchResponseOptions = {}): FetchResponseLike {
  const status = options.status ?? 200
  const setCookies = options.setCookies
  const entries = Object.entries(options.headers ?? {})
    .map(([key, value]) => [key.toLowerCase(), value] as const)
  const text = options.body === undefined
    ? ''
    : typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body)

  return {
    status,
    ok: status >= 200 && status < 300,
    ...(options.url === undefined ? {} : { url: options.url }),
    headers: {
      get(name: string) {
        const lower = name.toLowerCase()
        const found = entries.find(([key]) => key === lower)
        return found === undefined ? null : found[1]
      },
      ...(setCookies === undefined ? {} : { getSetCookie: () => setCookies.slice() }),
      forEach(callback: (value: string, key: string) => void) {
        for (const [key, value] of entries)
          callback(value, key)
      },
    },
    async text() {
      return text
    },
  }
}
