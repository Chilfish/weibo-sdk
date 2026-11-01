import type { BuildCommentsResponse } from '../../endpoints/tweet'
import type { TweetCommentsPageResult, TweetEmptyReason } from './types'
import type { RawTweet } from '~/models/data/Tweet'
import { isRawTweet, normalizeComment } from '~/models/data/Tweet'

/** 连续「整页被过滤」的页数上限：防止上游忽略 page 时无限翻页。 */
export const MAX_FILTERED_PAGES = 3

/** 过滤掉广告等无效微博（E2：入参 `unknown[]`，经 `isRawTweet` 收窄为 `RawTweet`）。 */
export function filterRawTweets(rawList: unknown[]): RawTweet[] {
  return rawList.filter((item): item is RawTweet =>
    isRawTweet(item) && !(item as { isAd?: unknown }).isAd)
}

/** 评论 raw 页 → 归一化分页。 */
export function commentsPageFromRaw(raw: BuildCommentsResponse): TweetCommentsPageResult {
  const comments = (raw.data ?? []).map(item => normalizeComment(item))
  const cursor = typeof raw.max_id === 'number' ? raw.max_id : 0
  const notice = raw.trendsText ?? raw.tip_msg
  const page: TweetCommentsPageResult = {
    comments,
    cursor,
    hasMore: cursor !== 0 && comments.length > 0,
  }
  if (raw.total_number !== undefined)
    page.total = raw.total_number
  if (notice)
    page.notice = notice
  if (comments.length === 0)
    page.emptyReason = emptyCommentsReason(raw)
  return page
}

/**
 * 空评论页的语义。
 *
 * 空页有两种来源，响应结构上无法区分：热度排序先返回空页（上游 `max_id` 仍非 0），
 * 或者这一页被风控 / 权限挡住。因此：
 * - `total_number === 0`：上游明确说没有评论 → `none`；
 * - 其余（`total > 0` 或没有计数）：只能标 `unknown`。
 *
 * `trendsText` / `tip_msg` 是上游文案（可能是防火墙提示，也可能只是「已加载全部评论」），
 * 原样保留在 `notice`，不参与分类。
 */
function emptyCommentsReason(raw: BuildCommentsResponse): TweetEmptyReason {
  if (raw.total_number === 0)
    return 'none'
  return 'unknown'
}

/** 解析 `searchProfile` 的 `data.total`（number 或数字字符串）。 */
export function parseSearchTotal(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/** 首页 Feed 游标归一化：正数 / 非空非 0 字符串；其余（0 / -1 / 空串）视为没有下一页。 */
export function normalizeFeedCursor(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0)
    return String(value)
  if (typeof value === 'string' && value !== '' && value !== '0' && value !== '-1')
    return value
  return undefined
}

/** 页码归一化：只接受 >= 1 的有限数；其余按第一页处理（上游 `page=0` 与 1 等价）。 */
export function normalizeLikerPage(page?: number): number {
  if (page === undefined || !Number.isFinite(page))
    return 1
  const normalized = Math.floor(page)
  return normalized >= 1 ? normalized : 1
}

/** 翻页上限归一化：缺省 / 非有限数 = 不限；其余取非负整数。 */
export function normalizeLikerMaxPages(maxPages?: number): number {
  if (maxPages === undefined || !Number.isFinite(maxPages))
    return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(maxPages))
}
