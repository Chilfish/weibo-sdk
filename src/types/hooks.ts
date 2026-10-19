import type { IResource, IResourceType } from './resources'

/**
 * 会话自检策略。
 *
 * - `none`：不自检（首次请求直接被上游拒绝）
 * - `lazy`：首次发起请求前自检（默认）
 * - `eager`：`new WeiboSDK()` 后立即后台自检（错误在后续请求前抛出）
 */
export type WeiboSDKSelfCheckMode = 'none' | 'lazy' | 'eager'

/**
 * 请求元信息快照（供 hooks 诊断用；不含 Cookie 等敏感头）。
 */
export interface WeiboSDKRequestMeta {
  /** HTTP 方法 */
  method: 'GET' | 'POST'
  /** 完整请求 URL */
  url: string
  /** 实际发送的请求头 */
  headers?: Record<string, string>
}

/**
 * 所有 hook 元数据的公共字段。
 */
export interface WeiboSDKHookBaseMeta {
  /** 事件发生时间（毫秒时间戳） */
  timestamp: number
  /** 追踪 id，用于串联同一次请求的 hooks 与 telemetry */
  trace_id: string
}

/**
 * `onFetched`（已 deprecated）的元数据：请求成功且通过 schema 校验后触发。
 */
export interface WeiboSDKFetchMeta extends WeiboSDKHookBaseMeta {
  /** 端点标识（如 `statuses/show`） */
  endpoint?: string
  /** 请求元信息 */
  request?: WeiboSDKRequestMeta
  /** 调用方传入的端点参数 */
  args?: Record<string, unknown>
}

/**
 * `onError` 的元数据：区分失败发生在哪个阶段（自检 / 请求 / 响应码 / 解析）。
 */
export interface WeiboSDKErrorMeta extends WeiboSDKHookBaseMeta {
  /** 失败阶段：`preflight` 自检 / `request` 网络 / `response` 业务码 / `parse` schema 校验 */
  phase: 'preflight' | 'request' | 'response' | 'parse'
  /** 端点标识 */
  endpoint?: string
  /** 请求元信息 */
  request?: WeiboSDKRequestMeta
  /** 调用方传入的端点参数 */
  args?: Record<string, unknown>
  /** 上游业务码（`ok` 字段，若可从响应中读出） */
  ok?: number
  /** 上游返回的错误文案 */
  message?: string
}

/**
 * 请求级 raw 回调元数据（P1-9）。
 *
 * `onRaw` 在 Zod 校验前触发，`raw` 为端点原始响应（未校验）；调用方自行决定是否落盘。
 * 即使 `ok !== 1` 或 schema 校验失败，也会先收到 raw。
 */
export interface WeiboSDKRawMeta extends WeiboSDKHookBaseMeta {
  /** 端点标识 */
  endpoint?: string
  /** 资源类型（与端点 `resourceType` 一致） */
  resourceType?: IResourceType
  /** 请求元信息 */
  request?: WeiboSDKRequestMeta
  /** 调用方传入的端点参数 */
  args?: Record<string, unknown>
}

/**
 * SDK 生命周期事件（`sdk_init` / 自检开始-成功-失败），通过 `hooks.onLifecycle` 交付。
 */
export type WeiboSDKLifecycleEvent
  = | (WeiboSDKHookBaseMeta & { event_name: 'sdk_init' })
    | (WeiboSDKHookBaseMeta & { event_name: 'self_check_start', mode: WeiboSDKSelfCheckMode })
    | (WeiboSDKHookBaseMeta & { event_name: 'self_check_ok' })
    | (WeiboSDKHookBaseMeta & { event_name: 'self_check_error', error: unknown })

/**
 * SDK 生命周期与请求级回调集合。
 *
 * 所有 hook 的抛错都会向上传播（除文档另行说明），需要「失败不影响主流程」的场景请用 telemetry。
 */
export interface WeiboSDKHooks {
  /** 生命周期事件（构造、自检开始/成功/失败） */
  onLifecycle?: (event: WeiboSDKLifecycleEvent) => void | Promise<void>
  /**
   * 原始响应回调（P1-9）：在 Zod 校验前触发，拿到的 `raw` 是端点原始 JSON。
   *
   * 用于需要自行保存 raw 的下游（`ArchiveItem` 不携带 raw）。
   */
  onRaw?: (raw: unknown, meta: WeiboSDKRawMeta) => void | Promise<void>
  /**
   * @deprecated 使用 `onRaw`（原始响应）或 `config.telemetry`（Wide Events）替代。
   */
  onFetched?: <T extends IResourceType>(resource: T, data: IResource[T], meta: WeiboSDKFetchMeta) => void | Promise<void>
  /** 失败回调（自检 / 网络 / 业务码 / 解析），与结构化错误同一时机触发 */
  onError?: (error: unknown, meta: WeiboSDKErrorMeta) => void | Promise<void>
}
