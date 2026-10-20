/**
 * 通用分页器（page / cursor / max_id / since_id 共用语义）。
 *
 * 各端点的游标形态不同，但停止条件一致：
 * - 空页；
 * - 整页重复（上游忽略游标）；
 * - 游标缺失 / `undefined`（到底）或游标不前进；
 * - 达到 `total`；
 * - `maxPages`。
 *
 * 分页器只负责「翻页 + 去重 + 停止」，不关心条目类型；调用方通过 `getKey`
 * 提供去重键（建议使用稳定 id），并用 `onProgress` 消费每页进度。
 */

import { createStreamRange } from './streamRange'

/** 单页结果。`next` 缺省表示没有下一页（到底）。 */
export interface PaginationPage<T, TCursor extends string | number = number> {
  /** 本页条目（未去重） */
  items: T[]
  /** 下一页游标；缺省 / `undefined` 表示到底 */
  next?: TCursor
  /** 显式是否还有下一页；`false` 时立即停止 */
  hasMore?: boolean
  /** 上游总数（可用时用于提前停止） */
  total?: number
}

/** 每页进度。 */
export interface PaginationProgress<TCursor extends string | number = number> {
  /** 本次请求使用的游标（首屏为调用方传入的 `initialCursor`） */
  cursor?: TCursor
  /** 页码（从 1 开始，按请求轮次递增） */
  page: number
  /** 已产出的条目数（跨页去重后） */
  processed: number
  /** 本页去重前的条数 */
  pageSize: number
  /** 上游总数（可用时） */
  total?: number
}

/** `paginate` 的选项。 */
export interface PaginateOptions<T, TCursor extends string | number = number> {
  /** 起始游标（缺省 = 第一页） */
  initialCursor?: TCursor
  /** 最多翻页数（缺省 / 非有限数 = 不限） */
  maxPages?: number
  /** 去重键；缺省时不去重（也无法识别整页重复） */
  getKey?: (item: T) => string | undefined
  /** 最多产出的条目数（跨页去重后；缺省不限） */
  maxItems?: number
  /** 时间下界（含当天）：更早的条目停止翻页 */
  since?: number | string
  /** 时间上界（含当天）：更晚的条目跳过 */
  until?: number | string
  /** 条目时间读取器；提供 `since` / `until` 时必传 */
  getTime?: (item: T) => string | number | Date | undefined
  /** 每页进度回调；异常不会中断流 */
  onProgress?: (progress: PaginationProgress<TCursor>) => void | Promise<void>
}

/** 翻页上限归一化：缺省 / 非有限数 = 不限；其余取非负整数。 */
export function normalizeMaxPages(maxPages?: number): number {
  if (maxPages === undefined || !Number.isFinite(maxPages))
    return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(maxPages))
}

/** 游标是否为空（`undefined` / `null` / 空串）。`0` 由调用方决定是否作为终止值。 */
function isEmptyCursor(cursor: unknown): boolean {
  return cursor === undefined || cursor === null || cursor === ''
}

/**
 * 逐页产出条目。
 *
 * @param fetchPage 拉取一页；`cursor` 首屏为 `options.initialCursor`，之后为上一页的 `next`
 * @param options 去重 / 进度 / 上限
 *
 * @example
 * for await (const user of paginate(page => api.list(page), {
 *   initialCursor: 1,
 *   getKey: user => user.id,
 *   maxPages: 3,
 * })) {
 *   console.log(user.id)
 * }
 */
export async function* paginate<T, TCursor extends string | number = number>(
  fetchPage: (cursor: TCursor | undefined, page: number) => Promise<PaginationPage<T, TCursor>>,
  options: PaginateOptions<T, TCursor> = {},
): AsyncIterableIterator<T> {
  const maxPages = normalizeMaxPages(options.maxPages)
  const range = createStreamRange<T>(options, options.getTime)
  const seen = new Set<string>()
  let cursor = options.initialCursor
  let page = 1
  let pages = 0
  let processed = 0

  while (pages < maxPages) {
    const result = await fetchPage(cursor, page)
    pages += 1

    const items = result.items
    if (items.length === 0)
      break

    const fresh: T[] = []
    for (const item of items) {
      if (!options.getKey) {
        fresh.push(item)
        continue
      }
      const key = options.getKey(item)
      if (key === undefined || key === '') {
        fresh.push(item)
        continue
      }
      if (seen.has(key))
        continue
      seen.add(key)
      fresh.push(item)
    }

    // 整页重复 = 上游忽略了游标，视为到底，避免无限翻页。
    if (fresh.length === 0)
      break

    for (const item of fresh) {
      const decision = range.decide(item)
      if (decision === 'stop')
        break
      if (decision === 'skip')
        continue
      processed += 1
      yield item
    }

    try {
      await options.onProgress?.({
        cursor,
        page: pages,
        processed,
        pageSize: items.length,
        total: result.total,
      })
    }
    catch {
      // 进度回调异常不影响流
    }

    if (range.stopped)
      break

    if (result.hasMore === false)
      break
    if (result.total !== undefined && result.total >= 0 && processed >= result.total)
      break

    const next = result.next
    if (isEmptyCursor(next))
      break
    if (next === cursor)
      break

    cursor = next
    page += 1
  }
}
