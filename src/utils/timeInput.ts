import { InvalidConfigError } from '../models/errors/ConfigError'

/**
 * 时间参数解析（SDK / CLI 共用）。
 *
 * 微博的 `starttime` / `endtime` 只认 **unix 秒**，直接传日期字符串会被上游静默忽略。
 * 为了让调用方写 `searchByDate(uid, { starttime: '2026-10-13' })` 也能得到预期结果，
 * 这里在请求边界把可读日期换算成秒：
 * - 数字 / 纯数字字符串 → 按 unix 秒原样使用
 * - `YYYY-MM-DD` / `YYYYMMDD` → `start` 取当天 00:00:00，`end` 取当天 23:59:59
 *   （**运行环境的本地时区**；日期部分按本地日历校验，`2026-02-30` 不会静默滚动到 3 月）
 *
 * 非法输入抛 `InvalidConfigError`（`CONFIG_INVALID`），避免把上游会忽略的值发出去。
 */

/** 日期字符串换算到当天哪一端 */
export type TimeBoundary = 'start' | 'end'

export interface ResolveTimeInputOptions {
  /** `start` = 当天 00:00:00，`end` = 当天 23:59:59（默认 `start`） */
  boundary?: TimeBoundary
  /** 出错时写入 `context.field` 的配置项名（如 `starttime`） */
  field?: string
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
const COMPACT_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/
const UNIX_SECONDS_PATTERN = /^\d+$/

interface DateParts {
  year: number
  month: number
  day: number
}

function invalidTimeInput(value: number | string, field: string, reason: string): InvalidConfigError {
  return new InvalidConfigError(`Invalid ${field}: ${JSON.stringify(value)}. ${reason}`, { field, value })
}

function toUnixSeconds(value: number, raw: number | string, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw invalidTimeInput(raw, field, 'Expected unix seconds >= 0 or a date string (YYYY-MM-DD / YYYYMMDD).')
  }
  return Math.floor(value)
}

/** 解析日期字符串；不是日期格式返回 `undefined`，是日期格式但日期不存在返回 `null` */
function parseDateParts(value: string): DateParts | null | undefined {
  const match = DATE_ONLY_PATTERN.exec(value) ?? COMPACT_DATE_PATTERN.exec(value)
  if (!match)
    return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null

  return { year, month, day }
}

/**
 * 把 unix 秒或日期字符串统一换算为 unix 秒。
 *
 * @param value 数字 / 纯数字字符串（unix 秒），或 `YYYY-MM-DD` / `YYYYMMDD`
 * @param options `boundary`（日期取当天起始/结束）与 `field`（错误上下文）
 * @throws `InvalidConfigError`（`CONFIG_INVALID`）空串、非法日期、负数 / 非有限数、无法识别的格式
 */
export function resolveTimeInput(
  value: number | string,
  options: ResolveTimeInputOptions = {},
): number {
  const { boundary = 'start', field = 'time' } = options

  if (typeof value === 'number')
    return toUnixSeconds(value, value, field)

  const raw = value.trim()
  if (!raw) {
    throw invalidTimeInput(value, field, 'Expected unix seconds or a date string (YYYY-MM-DD / YYYYMMDD).')
  }

  const parts = parseDateParts(raw)
  if (parts === null) {
    throw invalidTimeInput(value, field, 'Date is not a valid calendar date.')
  }
  if (parts) {
    const date = boundary === 'end'
      ? new Date(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999)
      : new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0)
    return Math.floor(date.getTime() / 1000)
  }

  if (UNIX_SECONDS_PATTERN.test(raw))
    return toUnixSeconds(Number(raw), value, field)

  throw invalidTimeInput(value, field, 'Expected unix seconds (e.g. 1735689600) or a date string (YYYY-MM-DD / YYYYMMDD).')
}
