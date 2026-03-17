import type { IResourceType } from './resources'
import type { WeiboSDKError } from '~/models/errors/WeiboSDKError'

export interface TelemetryEventBase {
  event_name: string
  timestamp: number
  trace_id: string
}

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
    event_name: 'request_start'
    method: 'GET' | 'POST'
    url: string
    endpoint?: string
    resource_type?: IResourceType
    args_keys?: string
  })
  | (TelemetryEventBase & {
    event_name: 'request_success'
    method: 'GET' | 'POST'
    url: string
    endpoint?: string
    resource_type?: IResourceType
    duration_ms: number
    ok?: number
  })
  | (TelemetryEventBase & {
    event_name: 'request_error'
    method?: 'GET' | 'POST'
    url?: string
    endpoint?: string
    resource_type?: IResourceType
    phase: 'preflight' | 'request' | 'response' | 'parse'
    duration_ms?: number
    ok?: number
    message?: string
    error_name: string
    error_message?: string
    error_code?: string
    error_level?: WeiboSDKError['level']
    error_retryable?: boolean
  })
  | (TelemetryEventBase & {
    event_name: 'rate_limit_wait'
    wait_ms: number
    refill_rate_ms: number
    max_tokens: number
    tokens: number
  })
  | (TelemetryEventBase & {
    event_name: 'normalize_done'
    model: 'User' | 'Tweet'
    count?: number
    duration_ms?: number
  })

export interface WeiboSDKTelemetry {
  emit: (event: TelemetryEvent & Record<string, TelemetryPrimitive | undefined>) => void | Promise<void>
}
