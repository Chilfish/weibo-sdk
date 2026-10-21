import type { WeiboPlugin } from '~/services/internal/plugins/types'
import type { WeiboSDKLifecycleEvent } from '~/types/hooks'
import type { WeiboLogger, WeiboLogLevel, WeiboLogRecord } from '~/types/logging'
import type { TelemetryEvent, TelemetryPrimitive, WeiboSDKTelemetry } from '~/types/telemetry'
import { serializeTelemetryEvent } from './telemetryJsonl'

const LEVEL_RANK: Record<WeiboLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const ERROR_EVENTS = new Set([
  'request_error',
  'guest_token_error',
  'media_download_item_error',
  'archive_item_error',
  'self_check_error',
])

const WARN_EVENTS = new Set([
  'request_retry',
  'rate_limit_wait',
])

const DEBUG_EVENTS = new Set([
  'request_start',
  'guest_token_issue',
  'media_download_start',
  'archive_progress',
  'sdk_init',
  'self_check_start',
])

/**
 * 敏感字段名（大小写、`-` / `_` 归一化后精确匹配）。
 *
 * `credential_id` 是 Cookie 指纹，不在此列表；它不是明文。
 */
const SENSITIVE_KEYS = new Set([
  'cookie',
  'setcookie',
  'authorization',
  'xsrftoken',
  'xxsrftoken',
  'sub',
  'subp',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
])

/** 可直接写入 console / JSONL 的写入端。 */
export interface LogWriteStream {
  write: (chunk: string) => unknown
}

/** `createConsoleLogger` 的选项。 */
export interface ConsoleLoggerOptions {
  /** 最低级别（默认 `info`）。 */
  level?: WeiboLogLevel
  /** `json` 单行结构化（默认）/ `pretty` 人类可读。 */
  format?: 'json' | 'pretty'
  /** 默认 `stderr`；也可以传自定义 writer（测试 / 浏览器）。 */
  stream?: LogWriteStream | 'stdout' | 'stderr'
  /** 是否替换敏感键（默认 `true`）。 */
  redact?: boolean
  /** 缺省时间戳的时钟。 */
  now?: () => number
}

/** `createJsonlLogger` 的选项。 */
export interface JsonlLoggerOptions {
  /** 接收含行尾 `\n` 的完整一行；抛错会计入 `dropped`。 */
  write: (line: string, record: WeiboLogRecord) => void | Promise<void>
  /** 最低级别（默认 `info`）。 */
  level?: WeiboLogLevel
  /** 额外过滤；未命中计入 `dropped`。 */
  filter?: (record: WeiboLogRecord) => boolean
  /** 是否替换敏感键（默认 `true`）。 */
  redact?: boolean
  /** 单字段截断上限（默认复用 `telemetryJsonl`）。 */
  maxValueLength?: number
  /** 缺省时间戳的时钟。 */
  now?: () => number
}

/** JSONL logger 句柄：可直接作为 `config.logger`，并附带计数便于自检。 */
export interface JsonlLogger extends WeiboLogger {
  readonly written: number
  readonly dropped: number
}

/** logger bridge：把 Wide Events / 生命周期事件投递给 logger。 */
export interface LoggerBridge {
  /** 可直接作为 `config.telemetry` 的 sink。 */
  telemetry: WeiboSDKTelemetry
  /** 任意 Wide Event / 生命周期事件。 */
  event: (event: TelemetryEvent | WeiboSDKLifecycleEvent) => void
  /** 生命周期事件（与 `event` 等价，语义更明确）。 */
  lifecycle: (event: WeiboSDKLifecycleEvent) => void
}

function ignoreRejection(result: void | Promise<void>): void {
  if (result && typeof (result as Promise<void>).then === 'function')
    void (result as Promise<void>).catch(() => {})
}

function isPrimitive(value: unknown): value is TelemetryPrimitive {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
}

/** 按事件名映射日志级别；未登记的事件按 `info`。 */
export function levelForEvent(eventName: string): WeiboLogLevel {
  if (ERROR_EVENTS.has(eventName))
    return 'error'
  if (WARN_EVENTS.has(eventName))
    return 'warn'
  if (DEBUG_EVENTS.has(eventName))
    return 'debug'
  return 'info'
}

/** `level` 是否达到最低级别；`min` 未设置时全部放行。 */
export function isLogLevelEnabled(level: WeiboLogLevel, min?: WeiboLogLevel): boolean {
  if (!min)
    return true
  return LEVEL_RANK[level] >= LEVEL_RANK[min]
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '')
}

/** 把敏感字段替换为 `[redacted]`，返回新对象。 */
export function redactLogRecord(record: WeiboLogRecord): WeiboLogRecord {
  const output: WeiboLogRecord = { ...record }
  for (const key of Object.keys(output)) {
    if (SENSITIVE_KEYS.has(normalizeKey(key)))
      output[key] = '[redacted]'
  }
  return output
}

/**
 * Wide Event / 生命周期事件 → 日志记录。
 *
 * 只搬运 primitive 字段；`self_check_error` 的 `error` 展开为 `error_name` / `error_message`。
 */
export function toLogRecord(event: TelemetryEvent | WeiboSDKLifecycleEvent): WeiboLogRecord {
  const base: WeiboLogRecord = {
    level: levelForEvent(event.event_name),
    event_name: event.event_name,
    timestamp: event.timestamp,
    trace_id: event.trace_id,
  }

  if (event.event_name === 'self_check_error') {
    const error = event.error
    if (error instanceof Error) {
      base.error_name = error.name
      base.error_message = error.message
    }
    else {
      base.error_message = String(error)
    }
    return base
  }

  for (const [key, value] of Object.entries(event)) {
    if (key === 'event_name' || key === 'timestamp' || key === 'trace_id')
      continue
    if (isPrimitive(value))
      base[key] = value
  }
  return base
}

function normalizeRecord(
  record: WeiboLogRecord,
  options: { now: () => number, redact: boolean },
): WeiboLogRecord {
  const output: WeiboLogRecord = { ...record }
  if (typeof output.timestamp !== 'number' || !Number.isFinite(output.timestamp))
    output.timestamp = options.now()
  for (const key of Object.keys(output)) {
    if (output[key] === undefined)
      delete output[key]
  }
  return options.redact ? redactLogRecord(output) : output
}

function serializeLogRecord(record: WeiboLogRecord, maxValueLength?: number): string {
  return serializeTelemetryEvent(record, { maxValueLength })
}

function formatValue(value: TelemetryPrimitive | undefined): string {
  if (typeof value === 'string' && /[\s"=]/.test(value))
    return JSON.stringify(value)
  return String(value)
}

function formatPrettyLog(record: WeiboLogRecord): string {
  const time = new Date(record.timestamp ?? Date.now()).toISOString()
  const level = record.level.toUpperCase().padEnd(5)
  const head = `${time} ${level} ${record.event_name}`
  const fields = Object.entries(record)
    .filter(([key]) => key !== 'level' && key !== 'timestamp' && key !== 'event_name')
    .map(([key, value]) => `${key}=${formatValue(value)}`)
  return fields.length === 0 ? head : `${head} ${fields.join(' ')}`
}

function resolveProcessStream(name: 'stdout' | 'stderr'): LogWriteStream {
  const scope = globalThis as typeof globalThis & {
    process?: Record<string, LogWriteStream | undefined>
  }
  const stream = scope.process?.[name]
  if (stream)
    return stream

  // 浏览器 / 非 Node 运行时：回退到 console，避免依赖 process。
  return {
    write: name === 'stderr'
      ? chunk => console.error(chunk.replace(/\n$/, ''))
      : chunk => console.log(chunk.replace(/\n$/, '')),
  }
}

/**
 * 结构化 console logger。
 *
 * 默认写 **stderr**、单行 JSON、`info` 级别，并替换敏感字段。
 * CLI 不要把日志写到 stdout：stdout 是数据 / NDJSON 协议。
 *
 * @example
 * ```ts
 * const sdk = new WeiboSDK({ cookie, logger: createConsoleLogger({ level: 'debug' }) })
 * ```
 */
export function createConsoleLogger(options: ConsoleLoggerOptions = {}): WeiboLogger {
  const level = options.level ?? 'info'
  const format = options.format ?? 'json'
  const redact = options.redact ?? true
  const now = options.now ?? Date.now
  const stream = options.stream === undefined || typeof options.stream === 'string'
    ? resolveProcessStream(options.stream ?? 'stderr')
    : options.stream

  return {
    level,
    log(record) {
      if (!isLogLevelEnabled(record.level, level))
        return
      try {
        const normalized = normalizeRecord(record, { now, redact })
        const line = format === 'json'
          ? serializeLogRecord(normalized)
          : formatPrettyLog(normalized)
        stream.write(`${line}\n`)
      }
      catch {
        // logger must not break SDK behavior
      }
    },
  }
}

/**
 * JSONL logger：一行一条记录，可直接落文件 / 转发日志平台。
 *
 * `write` 抛错或 reject 只计入 `dropped`，不会影响业务。
 */
export function createJsonlLogger(options: JsonlLoggerOptions): JsonlLogger {
  if (typeof options.write !== 'function')
    throw new TypeError('createJsonlLogger: options.write must be a function')

  const level = options.level ?? 'info'
  const redact = options.redact ?? true
  const now = options.now ?? Date.now
  let written = 0
  let dropped = 0

  return {
    level,
    get written() {
      return written
    },
    get dropped() {
      return dropped
    },
    async log(record) {
      if (!isLogLevelEnabled(record.level, level))
        return
      try {
        const normalized = normalizeRecord(record, { now, redact })
        if (options.filter && !options.filter(normalized)) {
          dropped += 1
          return
        }
        const line = `${serializeLogRecord(normalized, options.maxValueLength)}\n`
        await options.write(line, normalized)
        written += 1
      }
      catch {
        dropped += 1
      }
    },
  }
}

/**
 * 多路 logger：每个子 sink 独立过滤 / 吞错。
 *
 * 不设置 `level`，由子 sink 各自决定；这样 console 可以只收 `warn`，
 * 文件 sink 同时收 `debug`。
 */
export function createMultiLogger(loggers: readonly WeiboLogger[]): WeiboLogger {
  const sinks = [...loggers]
  return {
    log(record) {
      for (const sink of sinks) {
        try {
          ignoreRejection(sink.log(record))
        }
        catch {
          // one broken sink must not break the others
        }
      }
    },
  }
}

/**
 * 组合两个 telemetry sink：任一缺失时直接返回另一个，避免额外分配。
 *
 * 两个都失败也不会抛出，保持「观测失败不影响业务」。
 */
export function combineTelemetry(
  primary?: WeiboSDKTelemetry,
  secondary?: WeiboSDKTelemetry,
): WeiboSDKTelemetry | undefined {
  if (!primary)
    return secondary
  if (!secondary)
    return primary

  return {
    async emit(event) {
      try {
        await primary.emit(event)
      }
      catch {
        // telemetry must not break SDK behavior
      }
      try {
        await secondary.emit(event)
      }
      catch {
        // telemetry must not break SDK behavior
      }
    },
  }
}

/**
 * 把 logger 包装成 bridge。
 *
 * - `telemetry` 可直接与 `config.telemetry` 组合；
 * - `lifecycle` 由门面在 `emitLifecycle` 中调用；
 * - 过滤、吞错都在这里完成，logger 实现方不需要重复处理。
 */
export function createLoggerBridge(logger?: WeiboLogger): LoggerBridge | undefined {
  if (!logger)
    return undefined

  const minLevel = logger.level
  const emit = (record: WeiboLogRecord): void => {
    if (!isLogLevelEnabled(record.level, minLevel))
      return
    try {
      ignoreRejection(logger.log(record))
    }
    catch {
      // logger must not break SDK behavior
    }
  }

  return {
    telemetry: {
      emit(event) {
        emit(toLogRecord(event))
      },
    },
    event(event) {
      emit(toLogRecord(event))
    },
    lifecycle(event) {
      emit(toLogRecord(event))
    },
  }
}

/**
 * 把 logger 接入插件管线；与 `config.logger` 共用同一套事件映射。
 *
 * 注意：同时配置 `config.logger` 与 `createLoggerPlugin()` 会重复输出，二选一。
 */
export function createLoggerPlugin(
  logger: WeiboLogger,
  options: { name?: string } = {},
): WeiboPlugin {
  const bridge = createLoggerBridge(logger)
  return {
    name: options.name ?? 'logger',
    apiVersion: 1,
    observe(event) {
      bridge?.event(event)
    },
  }
}
