import { WeiboSDKError } from './WeiboSDKError'

/**
 * 调用方配置不合法（如缺少 `cookie`、依赖未注入）。
 *
 * `context.field` 指向出问题的配置项；属于调用方错误，重试无意义（`retryable: false`）。
 */
export class InvalidConfigError extends WeiboSDKError {
  readonly code = 'CONFIG_INVALID'
  readonly level = 'business'
  readonly retryable = false
}
