import type { FetchLike, FetchResponseLike, TransportRequest, TransportResponse, WeiboTransport } from './types'
import { getGlobalFetch, TransportFailure } from './types'

export interface FetchTransportOptions {
  /** 注入 fetch（Worker / Edge / 测试替身）；缺省使用 `globalThis.fetch`。 */
  fetch?: FetchLike
}

function appendQuery(url: URL, query: Record<string, unknown> | undefined): void {
  if (!query)
    return
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null)
      continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null)
          url.searchParams.append(key, String(item))
      }
      continue
    }
    url.searchParams.append(
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    )
  }
}

function buildBody(body: Record<string, unknown> | undefined, headers: Record<string, string>): string | undefined {
  if (!body)
    return undefined

  const contentType = headers['content-type'] ?? ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null)
        params.append(key, String(value))
    }
    return params.toString()
  }

  headers['content-type'] = contentType === '' ? 'application/json' : contentType
  return JSON.stringify(body)
}

function normalizeHeaders(response: FetchResponseLike): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {}

  if (typeof response.headers.forEach === 'function') {
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      result[lower] = result[lower] === undefined
        ? value
        : [...(Array.isArray(result[lower]) ? result[lower] : [result[lower]!]), value]
    })
  }

  const setCookies = response.headers.getSetCookie?.()
  if (setCookies && setCookies.length > 0) {
    result['set-cookie'] = setCookies
  }
  else if (result['set-cookie'] === undefined) {
    const value = response.headers.get('set-cookie')
    if (value !== null)
      result['set-cookie'] = value
  }

  return result
}

function parseBody(text: string): unknown {
  if (text === '')
    return ''
  try {
    return JSON.parse(text)
  }
  catch {
    return text
  }
}

/**
 * 原生 fetch 传输实现（Worker / Edge / Deno / Bun / 浏览器 / 测试替身）。
 *
 * 与 `AxiosTransport` 的契约一致：所有 HTTP 状态码正常返回，只有网络 / 超时抛 `TransportFailure`。
 * `proxy` 由宿主 fetch 实现决定，本实现忽略（Node 的 fetch 代理需通过 dispatcher 注入）。
 */
export function fetchTransport(options: FetchTransportOptions = {}): WeiboTransport {
  return {
    async send(request: TransportRequest): Promise<TransportResponse> {
      const fetchImpl = options.fetch ?? getGlobalFetch()
      if (!fetchImpl) {
        throw new TransportFailure(
          'network',
          'fetch is not available in this runtime; inject one via fetchTransport({ fetch }).',
        )
      }

      const url = new URL(request.url)
      appendQuery(url, request.query)

      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(request.headers))
        headers[key.toLowerCase()] = value
      const body = request.method === 'POST' ? buildBody(request.body, headers) : undefined

      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, request.timeoutMs)

      const abortFromCaller = (): void => controller.abort()
      request.signal?.addEventListener('abort', abortFromCaller, { once: true })

      try {
        const response = await fetchImpl(url.toString(), {
          method: request.method,
          headers,
          body,
          redirect: request.redirect,
          signal: controller.signal,
        })

        return {
          status: response.status,
          headers: normalizeHeaders(response),
          data: parseBody(await response.text()),
          url: response.url ?? url.toString(),
        }
      }
      catch (error) {
        const isAbort = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
        const message = error instanceof Error ? error.message : String(error)
        throw new TransportFailure(
          timedOut || isAbort ? 'timeout' : 'network',
          message,
          { cause: error },
        )
      }
      finally {
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', abortFromCaller)
      }
    },
  }
}
