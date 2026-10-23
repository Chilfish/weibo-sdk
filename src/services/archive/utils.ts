import type { MyMblogResponse } from '../endpoints/tweet'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'

export type TimelineRawItem = MyMblogResponse['data']['list'][number]

/** 页内并发窗口默认值 / 上限。 */
export const DEFAULT_ARCHIVE_CONCURRENCY = 3
export const MAX_ARCHIVE_CONCURRENCY = 8

/** 微博上线日（unix 秒）；日期切片默认下界。 */
export const WEIBO_EPOCH_SECONDS = Math.floor(Date.UTC(2009, 7, 14) / 1000)
export const DEFAULT_SLICE_WINDOW = 30 * 24 * 60 * 60
export const MIN_SLICE_WINDOW = 60
export const MAX_SLICE_WINDOW = 5 * 365 * 24 * 60 * 60
export const DEFAULT_MAX_SLICE_ITEMS = 800
/**
 * searchProfile 的 `page > 1` 复用会话里最近一次 `page=1` 的窗口。
 * 窗口被别的查询覆盖时，重新请求 `page=1` 即可恢复；连续失败则判定为协议异常。
 */
export const MAX_SLICE_PAGE_REPRIMES = 2

/** 页内并发窗口：非有限值回退默认，其余夹到 `[1, 8]`。 */
export function resolveConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return DEFAULT_ARCHIVE_CONCURRENCY
  return Math.min(MAX_ARCHIVE_CONCURRENCY, Math.max(1, Math.floor(value)))
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function isRetryableError(error: unknown): boolean {
  return error instanceof WeiboSDKError ? error.retryable : false
}

export function toErrorTelemetryFields(error: unknown): {
  error_name: string
  error_message?: string
  error_code?: string
  error_level?: WeiboSDKError['level']
  error_retryable?: boolean
} {
  if (error instanceof WeiboSDKError) {
    return {
      error_name: error.name,
      error_message: error.message,
      error_code: error.code,
      error_level: error.level,
      error_retryable: error.retryable,
    }
  }
  if (error instanceof Error)
    return { error_name: error.name, error_message: error.message }
  return { error_name: typeof error }
}

/** 单页内按 mblogid 去重（保持上游顺序）。 */
export function uniqueByMblogId<T extends { mblogid: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of list) {
    if (seen.has(item.mblogid))
      continue
    seen.add(item.mblogid)
    out.push(item)
  }
  return out
}

/**
 * 整页重复保护：所有 id 都出现在上一页 → 上游忽略了 page/游标，视为到底。
 * 避免上游重复返回同一页时无限翻页。
 */
export function isRepeatedPage(ids: string[], previousPageIds: Set<string>): boolean {
  return ids.length > 0 && ids.every(id => previousPageIds.has(id))
}

/** 解析上游 `created_at`（如 `Mon Oct 19 13:56:50 +0800 2026`）为 unix 秒。 */
export function parseCreatedAt(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === '')
    return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

/** `searchProfile.data.total` 实测为 number | string；统一解析为数字。 */
export function parseTotal(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** 游标解析：`next_cursor` 实测为 number | string；非法值按 `0`（到底）处理。 */
export function parseCursor(value: unknown): number {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/** 游标字符串归一化：空 / `0` / `-1` 视为缺省（第一页）。 */
export function normalizeCursorString(value: unknown): string | undefined {
  if (value === undefined || value === null)
    return undefined
  const text = String(value).trim()
  if (text === '' || text === '0' || text === '-1')
    return undefined
  return text
}

/** 置顶微博判定（上游字段不稳定；只认明确的布尔 / 数字标记）。 */
export function isPinnedRaw(raw: TimelineRawItem): boolean {
  return raw.isTop === true || raw.isTop === 1 || raw.top === true || raw.top === 1
}

/** 原创微博判定：没有 `retweeted_status`。 */
export function isOriginalRaw(raw: TimelineRawItem): boolean {
  return raw.retweeted_status === undefined || raw.retweeted_status === null
}
