// src/models/errors/TransportError.ts
import { WeiboSDKError } from './WeiboSDKError'

export class ConnectionTimeoutError extends WeiboSDKError {
  readonly code = 'NET_TIMEOUT'
  readonly level = 'transport'
  readonly retryable = true
}

export class NetworkRequestError extends WeiboSDKError {
  readonly code = 'NET_REQUEST_FAILED'
  readonly level = 'transport'
  readonly retryable = true
}
