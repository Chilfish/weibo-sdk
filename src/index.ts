// src/index.ts
import pkg from '../package.json' with { type: 'json' }

export const VERSION = pkg.version

export * from './capabilities'
export * from './models/data'
export * from './models/errors'
export * from './models/view/TweetContext'
export type {
  Credential,
  CredentialResolveContext,
  CredentialResolver,
} from './services/internal/CredentialResolver'
export type {
  BeforeRetryResult,
  ErrorContext,
  PluginRequestInfo,
  RequestContext,
  ResponseContext,
  RetryContext,
  WeiboEvent,
  WeiboPlugin,
} from './services/internal/plugins'
export { fetchTransport, TransportFailure } from './services/internal/transport'
export type {
  FetchLike,
  FetchResponseLike,
  TransportFailureKind,
  TransportMethod,
  TransportRequest,
  TransportRequestMeta,
  TransportResponse,
  WeiboTransport,
} from './services/internal/transport'
export * from './types'
export {
  createConsoleLogger,
  createJsonlLogger,
  createLoggerPlugin,
  createMultiLogger,
  isLogLevelEnabled,
  levelForEvent,
  redactLogRecord,
} from './utils/logger'
export type {
  ConsoleLoggerOptions,
  JsonlLogger,
  JsonlLoggerOptions,
  LogWriteStream,
} from './utils/logger'
export * from './utils/schemaDrift'
export * from './utils/telemetryJsonl'
export * from './utils/tweetId'
export * from './WeiboSDK'
