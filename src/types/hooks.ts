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

export type WeiboSDKLifecycleEvent
  = | (WeiboSDKHookBaseMeta & { event_name: 'sdk_init' })
    | (WeiboSDKHookBaseMeta & { event_name: 'self_check_start', mode: WeiboSDKSelfCheckMode })
    | (WeiboSDKHookBaseMeta & { event_name: 'self_check_ok' })
    | (WeiboSDKHookBaseMeta & { event_name: 'self_check_error', error: unknown })

export interface WeiboSDKHooks {
  onLifecycle?: (event: WeiboSDKLifecycleEvent) => void | Promise<void>
  onFetched?: <T extends IResourceType>(resource: T, data: IResource[T], meta: WeiboSDKFetchMeta) => void | Promise<void>
  onError?: (error: unknown, meta: WeiboSDKErrorMeta) => void | Promise<void>
}
