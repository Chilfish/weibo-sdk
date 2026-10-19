import type { IResource, IResourceType } from './resources'

export type WeiboSDKSelfCheckMode = 'none' | 'lazy' | 'eager'

export interface WeiboSDKRequestMeta {
  method: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
}

export interface WeiboSDKHookBaseMeta {
  timestamp: number
  trace_id: string
}

export interface WeiboSDKFetchMeta extends WeiboSDKHookBaseMeta {
  endpoint?: string
  request?: WeiboSDKRequestMeta
  args?: Record<string, unknown>
}

export interface WeiboSDKErrorMeta extends WeiboSDKHookBaseMeta {
  phase: 'preflight' | 'request' | 'response' | 'parse'
  endpoint?: string
  request?: WeiboSDKRequestMeta
  args?: Record<string, unknown>
  ok?: number
  message?: string
}

/**
 * 请求级 raw 回调元数据（P1-9）。
 *
 * `onRaw` 在 Zod 校验前触发，`raw` 为端点原始响应（未校验）；调用方自行决定是否落盘。
 * 即使 `ok !== 1` 或 schema 校验失败，也会先收到 raw。
 */
export interface WeiboSDKRawMeta extends WeiboSDKHookBaseMeta {
  endpoint?: string
  resourceType?: IResourceType
  request?: WeiboSDKRequestMeta
  args?: Record<string, unknown>
}

export type WeiboSDKLifecycleEvent
  = | (WeiboSDKHookBaseMeta & { event_name: 'sdk_init' })
    | (WeiboSDKHookBaseMeta & { event_name: 'self_check_start', mode: WeiboSDKSelfCheckMode })
    | (WeiboSDKHookBaseMeta & { event_name: 'self_check_ok' })
    | (WeiboSDKHookBaseMeta & { event_name: 'self_check_error', error: unknown })

export interface WeiboSDKHooks {
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
  onError?: (error: unknown, meta: WeiboSDKErrorMeta) => void | Promise<void>
}
