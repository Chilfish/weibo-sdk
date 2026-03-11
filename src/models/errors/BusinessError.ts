import { WeiboSDKError } from './WeiboSDKError'

/**
 * 微博接口返回了明确的失败（如 `ok !== 1`）。
 */
export class WeiboAPINotOkError extends WeiboSDKError {
  readonly code = 'API_NOT_OK'
  readonly level = 'business'
  readonly retryable = false
}

/**
 * Cookie 失效/未登录导致的会话不可用。
 */
export class WeiboSessionExpiredError extends WeiboSDKError {
  readonly code = 'AUTH_SESSION_EXPIRED'
  readonly level = 'business'
  readonly retryable = false
}
