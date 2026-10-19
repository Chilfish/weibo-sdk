// src/models/errors/TransportError.ts
import { WeiboSDKError } from './WeiboSDKError'

/**
 * 请求超时（axios `ECONNABORTED` / `ETIMEDOUT`）。
 *
 * `context.code` 保留底层 axios 错误码；传输层错误可重试（`retryable: true`）。
 */
export class ConnectionTimeoutError extends WeiboSDKError {
  readonly code = 'NET_TIMEOUT'
  readonly level = 'transport'
  readonly retryable = true
}

/**
 * 网络请求失败（DNS / 连接被拒 / 非 2xx 等）。
 *
 * `context` 携带 `status` / `data`（若上游有响应体）；可重试（`retryable: true`）。
 */
export class NetworkRequestError extends WeiboSDKError {
  readonly code = 'NET_REQUEST_FAILED'
  readonly level = 'transport'
  readonly retryable = true
}
