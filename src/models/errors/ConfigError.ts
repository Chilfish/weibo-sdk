import { WeiboSDKError } from './WeiboSDKError'

export class InvalidConfigError extends WeiboSDKError {
  readonly code = 'CONFIG_INVALID'
  readonly level = 'business'
  readonly retryable = false
}
