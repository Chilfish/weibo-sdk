import type { TelemetryEvent, TelemetryPrimitive, WeiboSDKTelemetry } from '~/types/telemetry'

/**
 * Telemetry JSONL 消费端原语（P2-3 / review E4）。
 *
 * 设计约束：
 * - **纯函数 + 注入 IO**：`createJsonlTelemetry({ write })` 不读环境、不建连接，
 *   单测与浏览器端（web-v3 / monkey）都可以复用。
 * - **一行一事件**：每个事件序列化为单行 JSON（NDJSON / JSONL），行尾补 `\n`，
 *   便于 `process.stdout` 重定向、`fs.WriteStream`、`fetch` 流式上报。
 * - **绝不抛错**：`emit()` 吞掉序列化 / filter / write 的所有异常（SDK 契约：
 *   telemetry 不得影响业务），失败事件计入 `dropped`。
 */

/** 非 primitive 字段折叠为字符串后的长度上限（超出截断并加 `…`）。 */
export const JSONL_MAX_VALUE_LENGTH = 256

/** 无法扁平化的值（循环引用、嵌套 BigInt 等）的占位字符串。 */
const UNSERIALIZABLE = '[unserializable]'

/**
 * 扁平化后的一行记录：键保持事件中的插入顺序，值一定是 JSON 可表达的 primitive。
 */
export type TelemetryRecord = Record<string, TelemetryPrimitive>

/**
 * exporter 接受的事件形状。
 *
 * 放宽到 `TelemetryEvent | (Record<string, unknown> & { event_name: string })` 的原因：
 * `WeiboSDKTelemetry.emit` 的入参是 `TelemetryEvent & Record<...>`（带索引签名），
 * 而 `TelemetryEvent` 是 interface 联合、没有隐式索引签名，二者互相不能赋值。
 * 消费端通常持有 `TelemetryEvent` 变量，这里统一兼容两种写法。
 */
export type TelemetryJsonlInput = TelemetryEvent | (Record<string, unknown> & { event_name: string })

/**
 * 序列化选项（`toJsonlRecord` / `serializeTelemetryEvent` / `createJsonlTelemetry` 共用）。
 */
export interface JsonlSerializeOptions {
  /** 单字段字符串上限，默认 {@link JSONL_MAX_VALUE_LENGTH} */
  maxValueLength?: number
  /** `timestamp` 缺失 / 非法时的补时时钟，默认 `Date.now` */
  now?: () => number
}

/**
 * `createJsonlTelemetry` 的构造选项：在序列化选项之上增加写入端与过滤条件。
 */
export interface JsonlTelemetryOptions extends JsonlSerializeOptions {
  /** 接收一行完整 JSONL（含行尾 `\n`）。返回 Promise 时会被 `await`。 */
  write: (line: string, event: TelemetryJsonlInput) => void | Promise<void>
  /** 只导出满足条件的事件（如 `isArchiveProgress`）；未命中计入 `dropped`。 */
  filter?: (event: TelemetryJsonlInput) => boolean
}

/**
 * JSONL exporter 句柄：可直接作为 `config.telemetry`，并附带写出/丢弃计数便于自检。
 */
export interface JsonlTelemetry extends WeiboSDKTelemetry {
  /** 写入一行 JSONL；永不抛错（失败计入 `dropped`）。 */
  emit: (event: TelemetryJsonlInput) => Promise<void>
  /** 已成功写出的行数 */
  readonly written: number
  /** 未写出的事件数（被 filter 过滤 / 序列化或写入失败） */
  readonly dropped: number
}

/** `archive_progress` 事件（ArchiveService P1-3）的收窄类型。 */
export type ArchiveProgressEvent = Extract<TelemetryEvent, { event_name: 'archive_progress' }>

/**
 * `archive_progress` 事件的派生摘要（供 CLI / 长任务 UI 直接展示）。
 */
export interface ArchiveProgressSummary {
  phase: string
  processed: number
  total?: number
  remaining?: number
  /** 0-100，一位小数；`total` 未知时为 `undefined` */
  percent?: number
  /** 人类可读的一行摘要，例如 `timeline 25/200 (12.5%) · 175 remaining` */
  text: string
}

function truncate(value: string, maxValueLength: number): string {
  return value.length > maxValueLength ? `${value.slice(0, maxValueLength)}…` : value
}

/**
 * 把任意值收敛为 Wide Event 允许的 primitive。
 *
 * - `undefined` → 丢弃字段（返回 `undefined`）
 * - `null` / `string` / `boolean` → 原样
 * - `number` → 有限值原样；`NaN` / `Infinity` 归为 `null`（JSON 无法表达）
 * - `bigint` → 十进制字符串
 * - `function` / `symbol` → 丢弃字段
 * - 对象 / 数组 / `Date` → JSON 字符串（截断）；循环引用等 → `[unserializable]`
 */
function toPrimitive(value: unknown, maxValueLength: number): TelemetryPrimitive | undefined {
  if (value === undefined)
    return undefined
  if (value === null)
    return null

  if (value instanceof Date)
    return truncate(Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString(), maxValueLength)

  switch (typeof value) {
    case 'string':
      return truncate(value, maxValueLength)
    case 'number':
      return Number.isFinite(value) ? value : null
    case 'boolean':
      return value
    case 'bigint':
      return truncate(value.toString(), maxValueLength)
    case 'function':
    case 'symbol':
      return undefined
    default:
      break
  }

  try {
    const json = JSON.stringify(value)
    if (json === undefined)
      return undefined
    return truncate(json, maxValueLength)
  }
  catch {
    // BigInt 嵌套、循环引用等
    return UNSERIALIZABLE
  }
}

/**
 * 事件 → 扁平 primitive 记录（保留字段插入顺序，丢弃无法表达的值）。
 *
 * @param event 待扁平化的事件（Wide Event 或任意带 `event_name` 的对象）
 * @param options `maxValueLength` 单字段截断上限；`now` 补时间戳的时钟
 * @returns 只含 primitive 的键值记录；`timestamp` 缺失/非法时用 `now()` 补齐
 */
export function toJsonlRecord(
  event: TelemetryJsonlInput,
  options: JsonlSerializeOptions = {},
): TelemetryRecord {
  const { maxValueLength = JSONL_MAX_VALUE_LENGTH, now = Date.now } = options
  const record: TelemetryRecord = {}

  for (const [key, value] of Object.entries((event ?? {}) as Record<string, unknown>)) {
    const primitive = toPrimitive(value, maxValueLength)
    if (primitive !== undefined)
      record[key] = primitive
  }

  // `timestamp` 是 Wide Event 必填项：缺失 / 非法时补当前时间，保证下游排序可用。
  if (typeof record.timestamp !== 'number')
    record.timestamp = now()

  return record
}

/**
 * 单个事件 → 单行 JSON（**不含**行尾换行）。
 *
 * 想要 NDJSON / JSONL 完整一行的场景请用 `createJsonlTelemetry`（它负责补 `\n` 并吞错）。
 *
 * @param event 待序列化的事件
 * @param options 序列化选项
 * @returns 一行 JSON 字符串（无换行）；理论上不会抛错（不可序列化值已降级为占位串）
 */
export function serializeTelemetryEvent(
  event: TelemetryJsonlInput,
  options: JsonlSerializeOptions = {},
): string {
  return JSON.stringify(toJsonlRecord(event, options))
}

/**
 * 构造 JSONL exporter，可直接作为 `config.telemetry` 传给 `WeiboSDK`。
 *
 * ```ts
 * const telemetry = createJsonlTelemetry({ write: line => process.stdout.write(line) })
 * const sdk = new WeiboSDK({ cookie, telemetry })
 * ```
 *
 * 任何异常（含 `write` 抛错）都被吞掉并计入 `dropped`，不会中断归档。
 *
 * @param options `write`（必填，接收含 `\n` 的完整行）；`filter` 只导出部分事件；序列化选项
 * @returns 带 `emit` / `written` / `dropped` 的 exporter
 * @throws `TypeError` `options.write` 不是函数时（构造期即失败，属于编程错误）
 */
export function createJsonlTelemetry(options: JsonlTelemetryOptions): JsonlTelemetry {
  const { write, filter, maxValueLength, now } = options
  if (typeof write !== 'function')
    throw new TypeError('createJsonlTelemetry: options.write must be a function')

  let written = 0
  let dropped = 0

  return {
    get written() {
      return written
    },
    get dropped() {
      return dropped
    },
    async emit(event) {
      if (event === null || typeof event !== 'object') {
        dropped += 1
        return
      }

      try {
        if (filter && !filter(event)) {
          dropped += 1
          return
        }
      }
      catch {
        dropped += 1
        return
      }

      let line: string
      try {
        line = `${serializeTelemetryEvent(event, { maxValueLength, now })}\n`
      }
      catch {
        dropped += 1
        return
      }

      try {
        await write(line, event)
        written += 1
      }
      catch {
        // telemetry must not break SDK behavior
        dropped += 1
      }
    },
  }
}

/**
 * 判断事件是否为 `archive_progress`（可直接作为 `filter`）。
 *
 * @param event 任意事件（允许 `null` / `undefined`）
 * @returns 收窄后的 `ArchiveProgressEvent` 类型守卫结果
 */
export function isArchiveProgress(event: TelemetryJsonlInput | null | undefined): event is ArchiveProgressEvent {
  return !!event && (event as { event_name?: unknown }).event_name === 'archive_progress'
}

function toCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return undefined
  return Math.max(0, Math.floor(value))
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function formatPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1)
}

/**
 * `archive_progress` → 百分比 / 剩余量 / 一行摘要（长任务 UI 与 CLI 共用）。
 *
 * - `percent`：`processed / total * 100`，clamp 到 0-100，保留一位小数；`total` 未知时缺省
 * - `remaining`：优先用事件自带的 `remaining`，否则用 `total - processed`（不小于 0）
 * - `text`：例如 `timeline 25/200 (12.5%) · 175 remaining`；
 *   `total` 未知时为 `timeline 25 processed (total unknown)`
 *
 * @param event `archive_progress` 事件（非有限数字的计数按 0 / 缺省处理）
 * @returns 摘要（`phase` / `processed` / `total?` / `remaining?` / `percent?` / `text`）；纯函数，不抛错
 */
export function formatArchiveProgress(event: ArchiveProgressEvent): ArchiveProgressSummary {
  const phase = typeof event.phase === 'string' && event.phase.length > 0 ? event.phase : 'unknown'
  const processed = toCount(event.processed) ?? 0
  const total = toCount(event.total)
  const explicitRemaining = toCount(event.remaining)

  const remaining = explicitRemaining ?? (total === undefined ? undefined : Math.max(0, total - processed))
  const percent = total === undefined
    ? undefined
    : total === 0
      ? 0
      : round1(Math.min(100, Math.max(0, (processed / total) * 100)))

  const text = total === undefined || percent === undefined
    ? `${phase} ${processed} processed (total unknown)`
    : `${phase} ${processed}/${total} (${formatPercent(percent)}%) · ${remaining ?? 0} remaining`

  return {
    phase,
    processed,
    ...(total === undefined ? {} : { total }),
    ...(remaining === undefined ? {} : { remaining }),
    ...(percent === undefined ? {} : { percent }),
    text,
  }
}
