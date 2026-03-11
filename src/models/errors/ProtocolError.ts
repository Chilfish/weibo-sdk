import { WeiboSDKError } from './WeiboSDKError'

export class UnexpectedAPIResponseError extends WeiboSDKError {
  readonly code = 'API_BAD_RESPONSE'
  readonly level = 'protocol'
  readonly retryable = false
}
