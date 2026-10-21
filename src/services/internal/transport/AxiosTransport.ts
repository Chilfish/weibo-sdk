import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import type { TransportRequest, TransportResponse, WeiboTransport } from './types'
import axios from 'axios'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { TransportFailure } from './types'

export interface AxiosTransportOptions {
  /** 复用外部 axios 实例（测试 / 自定义 adapter）；缺省时内部创建一个。 */
  client?: AxiosInstance
  /** 创建内部实例时的默认超时（单请求会被 `TransportRequest.timeoutMs` 覆盖）。 */
  timeoutMs?: number
}

interface AxiosProxyConfig {
  protocol: string
  host: string
  port: number
  auth?: {
    username: string
    password: string
  }
}

/** 把代理 URL 解析成 axios 的 proxy 配置；非法 URL 抛 `CONFIG_INVALID`。 */
function parseProxyUrl(value: string): AxiosProxyConfig {
  let parsed: URL
  try {
    parsed = new URL(value)
  }
  catch {
    throw new InvalidConfigError(`Invalid proxy URL: ${value}`, {
      field: 'proxy',
      value,
    })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidConfigError(`Proxy URL must use http(s): ${value}`, {
      field: 'proxy',
      value,
    })
  }

  return {
    protocol: parsed.protocol.replace(':', ''),
    host: parsed.hostname,
    port: parsed.port === ''
      ? (parsed.protocol === 'https:' ? 443 : 80)
      : Number.parseInt(parsed.port),
    ...(parsed.username === '' && parsed.password === ''
      ? {}
      : {
          auth: {
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
          },
        }),
  }
}

/** 把 axios 的 `AxiosHeaders` / 普通对象统一成小写键的响应头。 */
function normalizeHeaders(headers: unknown): Record<string, string | string[] | undefined> {
  if (!headers || typeof headers !== 'object')
    return {}

  const source = typeof (headers as { toJSON?: unknown }).toJSON === 'function'
    ? (headers as { toJSON: () => unknown }).toJSON()
    : headers
  if (!source || typeof source !== 'object')
    return {}

  const result: Record<string, string | string[] | undefined> = {}
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if (Array.isArray(value))
      result[lower] = value.map(item => String(item))
    else if (value === undefined || value === null)
      result[lower] = undefined
    else
      result[lower] = String(value)
  }
  return result
}

function isTimeoutError(error: { code?: unknown }): boolean {
  return error.code === 'ECONNABORTED'
    || error.code === 'ETIMEDOUT'
    || error.code === 'ESOCKETTIMEDOUT'
}

/**
 * axios 传输实现（默认）。
 *
 * 契约要点：
 * - 所有 HTTP 状态码都作为正常响应返回（`validateStatus: () => true`）。
 * - `redirect: 'manual'` 使用 `maxRedirects: 0`，3xx 原样返回。
 * - 只有网络 / 超时失败抛 `TransportFailure`。
 */
export function axiosTransport(options: AxiosTransportOptions = {}): WeiboTransport {
  const client = options.client ?? axios.create({ timeout: options.timeoutMs })

  return {
    async send(request: TransportRequest): Promise<TransportResponse> {
      const config: AxiosRequestConfig = {
        method: request.method,
        url: request.url,
        headers: { ...request.headers },
        params: request.query,
        data: request.method === 'POST' ? request.body : undefined,
        timeout: request.timeoutMs,
        signal: request.signal,
        validateStatus: () => true,
        ...(request.redirect === 'manual' ? { maxRedirects: 0 } : {}),
        ...(request.proxy === undefined
          ? {}
          : { proxy: request.proxy === false ? false : parseProxyUrl(request.proxy) }),
      }

      try {
        const response = await client.request<unknown>(config)
        return {
          status: response.status ?? 200,
          headers: normalizeHeaders(response.headers),
          data: response.data,
        }
      }
      catch (error) {
        if (axios.isAxiosError(error)) {
          // 即使配置了 validateStatus，个别 adapter / 响应限制仍可能带 response 抛错。
          if (error.response) {
            return {
              status: error.response.status,
              headers: normalizeHeaders(error.response.headers),
              data: error.response.data,
            }
          }
          throw new TransportFailure(
            isTimeoutError(error) ? 'timeout' : 'network',
            error.message,
            { cause: error },
          )
        }
        throw new TransportFailure(
          'network',
          error instanceof Error ? error.message : String(error),
          { cause: error },
        )
      }
    },
  }
}
