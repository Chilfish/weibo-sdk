import type { TelemetryPrimitive } from './telemetry'

/** 日志级别（由低到高）。 */
export type WeiboLogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * 一条结构化日志记录。
 *
 * 与 Wide Event 保持同一形状：除公共字段外只允许 primitive，便于 console / JSONL /
 * 日志平台直接索引。`timestamp` 缺省时由内置 sink 补齐。
 */
export interface WeiboLogRecord {
  level: WeiboLogLevel
  event_name: string
  timestamp?: number
  message?: string
  trace_id?: string
  [field: string]: TelemetryPrimitive | undefined
}

/**
 * 日志接收端契约（`config.logger`）。
 *
 * 约束：
 * - `level` 是**最低级别**；未设置表示不过滤。SDK 在调用 `log()` 前按此过滤。
 * - `log()` 抛错或返回 rejected Promise 都不会影响 SDK 业务。
 * - 记录只包含 primitive 字段；嵌套值不会进入日志。
 */
export interface WeiboLogger {
  readonly level?: WeiboLogLevel
  log: (record: WeiboLogRecord) => void | Promise<void>
}
