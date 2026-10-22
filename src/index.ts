// src/index.ts
import pkg from '../package.json' with { type: 'json' }

export const VERSION = pkg.version

export * from './capabilities'
export {
  migrateTweetV1toV2,
  normalizeComment,
  normalizeLiker,
  normalizeTweet,
  normalizeTweetUser,
} from './models/data'
export * from './models/errors'
export { buildTweetContext, renderTweetContextMarkdown } from './models/view/TweetContext'
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
export { createMemoryUserArchiveStore } from './services/public/userArchive/memoryStore'
export { mergeArchiveFiles } from './services/public/userArchive/merge'
export * from './types'
export {
  createConsoleLogger,
  createJsonlLogger,
  createLoggerPlugin,
  createMultiLogger,
} from './utils/logger'
export type {
  ConsoleLoggerOptions,
  JsonlLogger,
  JsonlLoggerOptions,
  LogWriteStream,
} from './utils/logger'
export * from './utils/schemaDrift'
export {
  createJsonlTelemetry,
  formatArchiveProgress,
  isArchiveProgress,
} from './utils/telemetryJsonl'
export type {
  ArchiveProgressEvent,
  ArchiveProgressSummary,
  JsonlTelemetry,
  JsonlTelemetryOptions,
  TelemetryJsonlInput,
} from './utils/telemetryJsonl'
export * from './utils/tweetId'
export * from './WeiboSDK'
