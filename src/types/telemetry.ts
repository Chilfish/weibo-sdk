import type { WeiboRetryKind } from './config'
import type { IResourceType } from './resources'
import type { WeiboSDKError } from '~/models/errors/WeiboSDKError'

/**
 * 所有 Wide Event 的公共字段：每条事件都必须带这三个键，便于日志系统索引与串联。
 */
export interface TelemetryEventBase {
  /** 事件名（稳定枚举值，用于分流与聚合） */
  event_name: string
  /** 事件时间（毫秒时间戳） */
  timestamp: number
  /** 追踪 id，同一次逻辑操作内保持一致 */
  trace_id: string
}

/**
 * Wide Event 允许的字段类型：只允许可序列化的标量（避免嵌套 JSON 破坏索引）。
 */
export type TelemetryPrimitive = string | number | boolean | null

/**
 * Wide Events: 扁平 KV（可序列化），用于可观测性与可诊断性。
 *
 * 约束：
 * - 必须包含 `event_name` / `timestamp` / `trace_id`
 * - 其余字段必须是 primitive（避免嵌套 JSON，便于日志系统索引）
 */
export type TelemetryEvent
  = | (TelemetryEventBase & {
    /** 请求即将发出（自检已通过、已进入限流队列前） */
    event_name: 'request_start'
    method: 'GET' | 'POST'
    url: string
    endpoint?: string
    resource_type?: IResourceType
    args_keys?: string
    /** 本次请求使用的鉴权身份 */
    auth_mode?: 'cookie' | 'guest'
    /** guest token 在本次逻辑请求内的刷新次数（0/1） */
    guest_refresh_count?: number
  })
  | (TelemetryEventBase & {
    /** 请求成功（已通过 `ok` 检查与 schema 校验） */
    event_name: 'request_success'
    method: 'GET' | 'POST'
    url: string
    endpoint?: string
    resource_type?: IResourceType
    duration_ms: number
    ok?: number
    auth_mode?: 'cookie' | 'guest'
    guest_refresh_count?: number
  })
  | (TelemetryEventBase & {
    /** 任一失败路径（自检 / 网络 / 业务码 / 解析），错误摘要已扁平化 */
    event_name: 'request_error'
    method?: 'GET' | 'POST'
    url?: string
    endpoint?: string
    resource_type?: IResourceType
    phase: 'preflight' | 'request' | 'response' | 'parse'
    duration_ms?: number
    ok?: number
    message?: string
    /** 该错误是第几次尝试产生（1 = 首次请求；重试耗尽时 = 总尝试次数） */
    attempt?: number
    error_name: string
    error_message?: string
    error_code?: string
    error_level?: WeiboSDKError['level']
    error_retryable?: boolean
    auth_mode?: 'cookie' | 'guest'
    guest_refresh_count?: number
    /** 鉴权失败原因（guest 刷新决策） */
    auth_failure_reason?: 'redirect_to_login' | 'visitor_entry' | 'ok_minus_100' | 'forbidden' | 'empty_object' | 'html'
  })
  | (TelemetryEventBase & {
    /** 请求失败但按重试策略进行退避重试（终态失败发 `request_error`，不重复发本事件） */
    event_name: 'request_retry'
    method?: 'GET' | 'POST'
    url?: string
    endpoint?: string
    resource_type?: IResourceType
    /** 已失败的尝试序号（1 = 首次请求失败，随后进行第 2 次尝试） */
    attempt: number
    /** 总尝试次数上限（`retries + 1`） */
    max_attempts: number
    /** 本次退避等待毫秒数（`Retry-After` 优先，否则指数退避 + jitter） */
    delay_ms: number
    /** 可重试失败类别 */
    reason: WeiboRetryKind
    /** 上游 HTTP 状态码（若适用） */
    status?: number
    error_name: string
    error_message?: string
    error_code?: string
    error_level?: WeiboSDKError['level']
    error_retryable?: boolean
    auth_mode?: 'cookie' | 'guest'
    guest_refresh_count?: number
  })
  | (TelemetryEventBase & {
    /** 访客 token 发放成功（由 `GuestTokenService` 发出，不含 token 明文） */
    event_name: 'guest_token_issue'
    source: 'preset' | 'mobile' | 'desktop'
    scope: 'pc' | 'all'
    duration_ms: number
    refreshed: boolean
  })
  | (TelemetryEventBase & {
    /** 访客 token 发放失败（由 `GuestTokenService` 发出） */
    event_name: 'guest_token_error'
    issuer: 'mobile' | 'desktop' | 'auto'
    duration_ms: number
    refreshed: boolean
    error_name: string
    error_message?: string
    status?: number
  })
  | (TelemetryEventBase & {
    /** 令牌桶等待发生（并发/间隔限流命中，或 432 后的全局暂停） */
    event_name: 'rate_limit_wait'
    wait_ms: number
    refill_rate_ms: number
    max_tokens: number
    tokens: number
    /** 等待原因：`token_refill` 补充令牌 / `rate_limited` 432 风控后的全局暂停 */
    reason?: 'token_refill' | 'rate_limited'
  })
  | (TelemetryEventBase & {
    /** 媒体下载开始（由 MediaService 发出） */
    event_name: 'media_download_start'
    mblogId: string
    dry_run: boolean
    concurrency: number
  })
  | (TelemetryEventBase & {
    /** 媒体单项失败 */
    event_name: 'media_download_item_error'
    mblogId: string
    media_id: string
    index: number
    media_type: string
    variant: string
    attempts: number
    http_status?: number
    fatal: boolean
    error_name: string
    error_message?: string
    error_code?: string
    error_level?: WeiboSDKError['level']
    error_retryable?: boolean
  })
  | (TelemetryEventBase & {
    /** 媒体下载结束 */
    event_name: 'media_download_done'
    mblogId: string
    total: number
    downloaded: number
    skipped: number
    failed: number
    bytes: number
    duration_ms: number
    refreshed: number
  })
  | (TelemetryEventBase & {
    /** raw → 领域模型归一化完成（用于观测归一化耗时/条数） */
    event_name: 'normalize_done'
    model: 'User' | 'Tweet' | 'UserMediaAsset' | 'UserAlbum' | 'TweetLiker' | 'CommentNotification' | 'LikeNotification' | 'UserGroup' | 'MblogGroup' | 'SuperTopicCategory' | 'SuperTopic'
    count?: number
    duration_ms?: number
  })
  | (TelemetryEventBase & {
    /** 归档进度（每页/每阶段一次；由 `ArchiveService` 发出） */
    event_name: 'archive_progress'
    uid: string
    phase: string
    processed: number
    total?: number
    remaining?: number
    source?: string
    page?: number
  })
  | (TelemetryEventBase & {
    /** 归档中单条/单页失败及按策略采取的动作（abort / skip / retry） */
    event_name: 'archive_item_error'
    uid: string
    phase: string
    stage: 'comments' | 'commentHistory' | 'likes' | 'reposts' | 'timeline' | 'favorites' | 'images' | 'videos'
    source?: string
    mblogId?: string
    parentMblogId?: string
    page?: number
    action: 'abort' | 'skip' | 'retry'
    error_name: string
    error_message?: string
    error_code?: string
    error_level?: WeiboSDKError['level']
    error_retryable?: boolean
  })

/**
 * telemetry 接收端契约（`config.telemetry`）。
 *
 * SDK 侧所有 emit 都包在 try/catch 中：`emit` 抛错或返回 rejected Promise
 * 都不会影响业务功能，因此实现方可放心做 IO。
 */
export interface WeiboSDKTelemetry {
  /**
   * 提交一条 Wide Event。
   *
   * 入参允许附带额外 primitive 字段（会与事件字段一起被扁平化），非 primitive 值由接收端决定如何处理。
   * 实现方应尽快返回（或自行排队），不要阻塞请求主流程。
   */
  emit: (event: TelemetryEvent & Record<string, TelemetryPrimitive | undefined>) => void | Promise<void>
}
