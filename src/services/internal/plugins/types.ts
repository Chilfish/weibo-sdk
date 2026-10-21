import type { AuthFailureReason } from '../CredentialResolver'
import type { WeiboTransport } from '../transport'
import type { WeiboRetryKind } from '~/types/config'
import type { WeiboSDKLifecycleEvent } from '~/types/hooks'
import type { IResourceType } from '~/types/resources'
import type { TelemetryEvent } from '~/types/telemetry'

/** 单次尝试的请求信息（插件可修改 headers / query / body）。 */
export interface PluginRequestInfo {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  query?: Record<string, unknown>
  body?: Record<string, unknown>
  endpoint?: string
  resourceType?: IResourceType
  /** 第几次尝试（1 = 首次请求）。 */
  attempt: number
  traceId: string
  authMode: 'cookie' | 'guest'
  /** 非敏感凭证标识。 */
  credentialId?: string
}

/** `beforeRequest` 上下文：鉴权头注入后、发送前。 */
export type RequestContext = PluginRequestInfo

/** `afterResponse` 上下文：收到响应、okPolicy / Zod 之前。 */
export interface ResponseContext extends PluginRequestInfo {
  status: number
  /** 响应头（小写键；`headers` 保留请求头，避免与请求上下文冲突）。 */
  responseHeaders: Record<string, string | string[] | undefined>
  data: unknown
  durationMs: number
}

/** `beforeRetry` 上下文：已决定重试、sleep 之前。 */
export interface RetryContext extends PluginRequestInfo {
  /** 总尝试次数上限（`retries + 1`）。 */
  maxAttempts: number
  /** 可重试失败类别。 */
  reason: WeiboRetryKind
  /** 当前计划延迟（毫秒）。 */
  delayMs: number
  /** 当前是否仍计划重试（供后续钩子参考）。 */
  retry: boolean
  error: unknown
}

/** `beforeRetry` 返回值：可改延迟或阻止重试。 */
export interface BeforeRetryResult {
  retry?: boolean
  delayMs?: number
}

/** `onError` 上下文：终态错误抛出前。 */
export interface ErrorContext extends PluginRequestInfo {
  phase: 'preflight' | 'request' | 'response' | 'parse'
  error: unknown
  /** 鉴权失败原因（若可归因）。 */
  authFailureReason?: AuthFailureReason
}

/** 插件可观察的事件（Wide Event / 生命周期事件）。 */
export type WeiboEvent = TelemetryEvent | WeiboSDKLifecycleEvent

/**
 * SDK 插件。
 *
 * 语义约定：
 * - `transport` / 生命周期钩子抛错为 **fatal**（向上传播）。
 * - `observe` 是只读观察者：不 await、抛错被吞掉、不能改变请求。
 * - `apiVersion` 当前必须为 `1`；不兼容直接 `CONFIG_INVALID`。
 * - 插件只在 `new WeiboSDK()` 时组装，不支持运行时热插拔。
 */
export interface WeiboPlugin {
  /** 唯一名；重名直接 `CONFIG_INVALID`，不静默去重。 */
  name: string
  /** 插件 API 版本；当前只接受 `1`。 */
  apiVersion: 1
  /** 排序：`pre` → `normal` → `post`；同组按注册顺序。 */
  enforce?: 'pre' | 'normal' | 'post'
  /** 包装 transport（cache / mock / circuit breaker / 请求签名）。 */
  transport?: (next: WeiboTransport) => WeiboTransport
  hooks?: {
    /** 发请求前；可改 headers / query / body。 */
    beforeRequest?: (context: RequestContext) => void | Promise<void>
    /** 收到响应后、okPolicy / Zod 之前；v1 约定只读。 */
    afterResponse?: (context: ResponseContext) => void | Promise<void>
    /** 已决定重试后、sleep 之前；可改延迟或阻止重试。 */
    beforeRetry?: (context: RetryContext) => void | BeforeRetryResult | Promise<void | BeforeRetryResult>
    /** 终态错误抛出前；返回 `Error` 可替换错误。 */
    onError?: (context: ErrorContext) => Error | void | Promise<Error | void>
  }
  /** 只读观察者：不 await、吞异常、不能改状态。 */
  observe?: (event: WeiboEvent) => void | Promise<void>
}
