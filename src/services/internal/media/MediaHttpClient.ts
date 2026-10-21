import type { AxiosRequestConfig } from 'axios'
import axios from 'axios'
import { MediaDownloadError, MediaInvalidResponseError } from '~/models/errors/MediaError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { parseRetryAfter } from '../RetryPolicy'
import { isAllowedHost } from './MediaNaming'

/** 字节流：只需异步可迭代 + 可选 destroy（不把 node:stream 暴露到公开 d.ts）。 */
export interface MediaByteStream extends AsyncIterable<Uint8Array> {
  destroy?: (error?: Error) => void
}

export interface MediaHttpRequest {
  url: string
  referer: string
  timeoutMs: number
  allowedHosts: readonly string[]
  redirectLimit?: number
  signal?: AbortSignal
}

export interface MediaHttpResponse {
  status: number
  finalUrl: string
  contentType?: string
  contentLength?: number
  body: MediaByteStream
  dispose: () => void
}

export interface MediaHttpClient {
  open: (request: MediaHttpRequest) => Promise<MediaHttpResponse>
}

export interface MediaHttpTransportResponse {
  status: number
  headers: Record<string, unknown>
  data: MediaByteStream
}

export interface MediaHttpTransport {
  request: (config: AxiosRequestConfig) => Promise<MediaHttpTransportResponse>
}

export interface AxiosMediaHttpClientDeps {
  transport?: MediaHttpTransport
  proxyUrl?: string
  /** 按媒体 URL 解析代理（动态 Provider）；优先于 `proxyUrl`。返回 `false` 表示直连。 */
  proxy?: (url: string) => string | null | undefined | false | Promise<string | null | undefined | false>
}

/** 媒体 CDN 默认主机后缀白名单。 */
export const DEFAULT_MEDIA_ALLOWED_HOSTS: readonly string[] = [
  'sinaimg.cn',
  'sina.com.cn',
  'weibo.com',
  'weibo.cn',
  'weibocdn.com',
  'wbimg.cn',
  'weiboimg.cn',
]

const MEDIA_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function createAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason
  if (reason instanceof Error)
    return reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function parseProxy(proxyUrl?: string | null | false): AxiosRequestConfig['proxy'] {
  if (!proxyUrl)
    return false
  try {
    const parsed = new URL(proxyUrl)
    return {
      host: parsed.hostname,
      port: Number.parseInt(parsed.port) || 80,
      protocol: parsed.protocol.replace(':', ''),
    }
  }
  catch {
    return false
  }
}

function createDefaultTransport(proxyUrl?: string): MediaHttpTransport {
  const client = axios.create({
    responseType: 'stream',
    maxRedirects: 0,
    validateStatus: () => true,
    proxy: parseProxy(proxyUrl),
  })

  return {
    async request(config) {
      const response = await client.request(config)
      return {
        status: response.status,
        headers: response.headers as Record<string, unknown>,
        data: response.data as MediaByteStream,
      }
    },
  }
}

function getHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target)
      continue
    if (Array.isArray(value))
      return value.length > 0 ? String(value[0]) : undefined
    if (typeof value === 'string')
      return value
    if (typeof value === 'number')
      return String(value)
  }
  return undefined
}

function normalizeContentType(value: string | undefined): string | undefined {
  const normalized = value?.split(';')[0]?.trim().toLowerCase()
  return normalized || undefined
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined)
    return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function destroyBody(body: MediaByteStream): void {
  try {
    body.destroy?.()
  }
  catch {
    // 清理失败不覆盖原始错误
  }
}

function toTransportError(error: unknown, url: string): WeiboSDKError {
  if (error instanceof WeiboSDKError)
    return error
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
  const reason = code === 'ECONNABORTED' || code === 'ETIMEDOUT' ? 'timeout' : 'network'
  return new MediaDownloadError(`Media request failed: ${error instanceof Error ? error.message : String(error)}`, {
    url,
    reason,
    code,
  })
}

function mapStatus(status: number, url: string, headers: Record<string, unknown>): WeiboSDKError {
  if (status === 403 || status === 404 || status === 410) {
    return new MediaDownloadError(`Media URL is expired or unavailable (HTTP ${status}).`, {
      url,
      status,
      reason: 'expired',
    })
  }
  if (status === 408) {
    return new MediaDownloadError('Media request timed out (HTTP 408).', { url, status, reason: 'timeout' })
  }
  if (status === 429) {
    return new MediaDownloadError('Media request was rate limited (HTTP 429).', {
      url,
      status,
      reason: 'rate-limit',
      retryAfterMs: parseRetryAfter(getHeader(headers, 'retry-after'), Date.now()),
    })
  }
  if (status >= 500) {
    return new MediaDownloadError(`Media server error (HTTP ${status}).`, { url, status, reason: 'http' })
  }
  return new MediaInvalidResponseError(`Unexpected media HTTP status: ${status}.`, { url, status })
}

function assertAllowedUrl(url: string, allowedHosts: readonly string[]): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    throw new MediaInvalidResponseError('Media URL is invalid.', { url, reason: 'invalid-url' })
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MediaInvalidResponseError('Media URL must use http(s).', {
      url,
      protocol: parsed.protocol,
      reason: 'invalid-protocol',
    })
  }
  if (!isAllowedHost(parsed.hostname, allowedHosts)) {
    throw new MediaInvalidResponseError('Media host is not allowed.', {
      url,
      host: parsed.hostname,
      reason: 'host-not-allowed',
    })
  }

  return parsed
}

/**
 * 创建媒体 HTTP 客户端。
 *
 * 与 `FetcherService` 完全独立：不携带 Cookie / XSRF，支持流式响应、手动重定向与主机白名单。
 */
export function createAxiosMediaHttpClient(deps: AxiosMediaHttpClientDeps = {}): MediaHttpClient {
  const transport = deps.transport ?? createDefaultTransport(deps.proxyUrl)

  return {
    async open(request) {
      if (request.signal?.aborted)
        throw createAbortError(request.signal)

      const redirectLimit = request.redirectLimit ?? 5
      let currentUrl = request.url

      for (let hop = 0; ; hop += 1) {
        assertAllowedUrl(currentUrl, request.allowedHosts)

        let response: MediaHttpTransportResponse
        try {
          const proxy = deps.proxy === undefined
            ? undefined
            : parseProxy(await deps.proxy(currentUrl))
          response = await transport.request({
            method: 'GET',
            url: currentUrl,
            responseType: 'stream',
            maxRedirects: 0,
            validateStatus: () => true,
            timeout: request.timeoutMs,
            signal: request.signal,
            ...(proxy === undefined ? {} : { proxy }),
            headers: {
              'referer': request.referer,
              'user-agent': MEDIA_USER_AGENT,
              'accept': '*/*',
              'accept-encoding': 'identity',
            },
          })
        }
        catch (error) {
          if (request.signal?.aborted)
            throw createAbortError(request.signal)
          throw toTransportError(error, currentUrl)
        }

        const headers = response.headers ?? {}
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = getHeader(headers, 'location')
          destroyBody(response.data)
          if (!location) {
            throw new MediaInvalidResponseError('Media redirect is missing Location.', {
              url: currentUrl,
              status: response.status,
              reason: 'bad-redirect',
            })
          }
          if (hop >= redirectLimit) {
            throw new MediaInvalidResponseError('Media redirect limit exceeded.', {
              url: currentUrl,
              status: response.status,
              reason: 'too-many-redirects',
            })
          }
          currentUrl = new URL(location, currentUrl).toString()
          continue
        }

        if (response.status === 200) {
          let disposed = false
          const dispose = (): void => {
            if (disposed)
              return
            disposed = true
            destroyBody(response.data)
          }
          return {
            status: response.status,
            finalUrl: currentUrl,
            contentType: normalizeContentType(getHeader(headers, 'content-type')),
            contentLength: parseContentLength(getHeader(headers, 'content-length')),
            body: response.data,
            dispose,
          }
        }

        destroyBody(response.data)
        throw mapStatus(response.status, currentUrl, headers)
      }
    },
  }
}
