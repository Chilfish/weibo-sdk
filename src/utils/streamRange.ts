import { InvalidConfigError } from '../models/errors/ConfigError'
import { resolveTimeInput } from './timeInput'

/**
 * 流式范围控制（所有 `stream*` 方法共用）。
 *
 * - `maxItems`：最多产出多少条（跨页去重后计数），与上游每页大小无关；
 * - `since` / `until`：只对时间倒序的流生效（如时间线、转发、@我、通知），
 *   条目时间早于 `since` 即停止翻页，晚于 `until` 的条目跳过；
 * - 起始游标 / 页码仍由各端点自己的选项控制（`page` / `maxId` / `sinceId` / `cursor`），
 *   用于断点续传与增量拉取。
 */

/** 只支持条数上限的流选项。 */
export interface StreamLimitOptions {
  /** 最多产出的条目数（缺省不限；`<= 0` 视为不产出） */
  maxItems?: number
}

/** 支持条数上限 + 日期边界的流选项。 */
export interface StreamRangeOptions extends StreamLimitOptions {
  /** 时间下界（含当天）：更早的条目停止翻页。`YYYY-MM-DD` / `YYYYMMDD` / unix 秒 */
  since?: number | string
  /** 时间上界（含当天）：更晚的条目跳过。`YYYY-MM-DD` / `YYYYMMDD` / unix 秒 */
  until?: number | string
}

/** 单条目的处理决定。`stop` 表示后续条目都不再需要。 */
export type StreamRangeDecision = 'take' | 'skip' | 'stop'

/** `createStreamRange` 的返回值。 */
export interface StreamRange<T> {
  /** 已产出的条目数 */
  readonly count: number
  /** 是否已达到 `maxItems` */
  readonly full: boolean
  /** 是否应停止翻页（达到 `maxItems` 或越过 `since`） */
  readonly stopped: boolean
  /** 判定条目：产出 / 跳过 / 停止 */
  decide: (item: T) => StreamRangeDecision
}

/** 翻页上限归一化：缺省 / 非有限数 = 不限；其余取非负整数。 */
export function normalizeMaxItems(maxItems?: number): number {
  if (maxItems === undefined || !Number.isFinite(maxItems))
    return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(maxItems))
}

/** 条目时间归一化为 unix 秒；无法解析时返回 `undefined`（按「不参与时间过滤」处理）。 */
function toUnixSeconds(value: string | number | Date | undefined): number | undefined {
  if (value === undefined)
    return undefined
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? Math.floor(time / 1000) : undefined
  }
  if (typeof value === 'number')
    return Number.isFinite(value) ? Math.floor(value) : undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined
}

/**
 * 创建流范围控制器。
 *
 * @param options `maxItems` / `since` / `until`
 * @param getTime 条目时间读取器；提供 `since` / `until` 时必传
 * @throws `InvalidConfigError`（`CONFIG_INVALID`）日期非法，或给了日期边界却没有 `getTime`
 */
export function createStreamRange<T>(
  options: StreamLimitOptions & Pick<StreamRangeOptions, 'since' | 'until'>,
  getTime?: (item: T) => string | number | Date | undefined,
): StreamRange<T> {
  const maxItems = normalizeMaxItems(options.maxItems)
  const hasDateBound = options.since !== undefined || options.until !== undefined
  if (hasDateBound && getTime === undefined) {
    throw new InvalidConfigError('since/until require a timestamped stream.', {
      field: options.since !== undefined ? 'since' : 'until',
    })
  }

  const since = options.since === undefined
    ? undefined
    : resolveTimeInput(options.since, { boundary: 'start', field: 'since' })
  const until = options.until === undefined
    ? undefined
    : resolveTimeInput(options.until, { boundary: 'end', field: 'until' })

  let count = 0
  let exhausted = false

  return {
    get count() {
      return count
    },
    get full() {
      return count >= maxItems
    },
    get stopped() {
      return count >= maxItems || exhausted
    },
    decide(item: T): StreamRangeDecision {
      if (count >= maxItems)
        return 'stop'

      const time = getTime?.(item)
      const seconds = toUnixSeconds(time)
      if (seconds !== undefined) {
        if (since !== undefined && seconds < since) {
          exhausted = true
          return 'stop'
        }
        if (until !== undefined && seconds > until)
          return 'skip'
      }

      count += 1
      return 'take'
    },
  }
}
