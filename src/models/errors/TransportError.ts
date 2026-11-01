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

/**
 * 上游明确拒绝了请求（HTTP 4xx，除 429 / 432 与访客 403 登录门控）。
 *
 * 参数不合法、资源不存在、权限不足都属于这一类：重发同一个请求不会变好，
 * 所以 `retryable` 是 `false`。判断下一步看 `context.status`：
 * 400 / 422 多为参数问题，401 / 403 多为登录态或权限，404 多为 id 不存在。
 *
 * `context` 携带 `status` / `data` / `endpoint` / `message`（上游提示文案）。
 */
export class UpstreamRejectedError extends WeiboSDKError {
  readonly code = 'UPSTREAM_REJECTED'
  readonly level = 'transport'
  readonly retryable = false
}

/**
 * 上游限流 / 风控：HTTP **432**（微博风控）或 **429**（Too Many Requests）。
 *
 * 归类为 `transport`：错误由 HTTP 状态码直接判定，与其余传输层错误同处「可重试」组；
 * 与业务语义错误（`ok !== 1`）不同，退避后重试通常能恢复。
 *
 * `context` 携带：
 * - `status`：HTTP 状态码（432 / 429）
 * - `retryAfterMs`：`Retry-After` 头解析结果（秒或 HTTP date），缺失时不出现
 * - `attempt`：这是第几次尝试（1 = 首次请求）
 * - `message`：响应体内的上游提示（若可解析）
 *
 * 命中后 `FetcherService` 会同步暂停全局令牌桶，避免并发请求同时撞墙。
 */
export class RateLimitError extends WeiboSDKError {
  readonly code = 'RATE_LIMITED'
  readonly level = 'transport'
  readonly retryable = true
}
