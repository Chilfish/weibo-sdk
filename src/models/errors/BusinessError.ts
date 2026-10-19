import { WeiboSDKError } from './WeiboSDKError'

/**
 * 微博接口返回了明确的失败（如 `ok !== 1`）。
 *
 * `context` 通常携带 `endpoint` / `args` / `ok` / `message` / `raw`；
 * 属于业务语义失败，重试无意义（`retryable: false`）。
 */
export class WeiboAPINotOkError extends WeiboSDKError {
  readonly code = 'API_NOT_OK'
  readonly level = 'business'
  readonly retryable = false
}

/**
 * Cookie 失效/未登录导致的会话不可用。
 *
 * 由端点自定义的 `okPolicy.notOkError` 在识别到登录态缺失时抛出；
 * 需要更新 Cookie 才能恢复，因此 `retryable: false`。
 */
export class WeiboSessionExpiredError extends WeiboSDKError {
  readonly code = 'AUTH_SESSION_EXPIRED'
  readonly level = 'business'
  readonly retryable = false
}
