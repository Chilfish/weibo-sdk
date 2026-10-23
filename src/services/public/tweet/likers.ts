import type { LikersResponse } from '../../endpoints/likers'
import type { TweetLikersOptions, TweetLikersPageResult, TweetLikersStreamOptions, TweetLikersStreamProgress } from './types'
import type { TweetLiker } from '~/types/domain/ILiker'
import { normalizeLiker } from '~/models/data/Tweet'
import { createStreamRange } from '~/utils/streamRange'
import { normalizeTweetIdInput } from '~/utils/tweetId'
import { normalizeLikerMaxPages, normalizeLikerPage } from './helpers'

/** `likers` / `streamLikers` 需要的数据源（由 `TweetService` 适配，避免模块直接依赖 HTTP 核心）。 */
export interface TweetLikersSource {
  /** 把任意微博 id 输入解析为数字 mid（`statuses/show` 兜底）。 */
  resolveMid: (input: string) => Promise<string>
  /** 请求一页点赞者。 */
  fetchPage: (id: string, page: number) => Promise<LikersResponse>
  /** 发出 `normalize_done` 事件；由服务层保留 telemetry 细节。 */
  emitNormalizeDone: (params: { count: number, durationMs: number }) => Promise<void>
}

/** 获取一页微博点赞者（`m.weibo.cn/api/attitudes/show`，上游只接受数字 mid）。 */
export async function loadLikersPage(
  source: TweetLikersSource,
  mblogId: string,
  options: TweetLikersOptions = {},
): Promise<TweetLikersPageResult> {
  const page = normalizeLikerPage(options.page)
  const startAt = Date.now()
  const id = await source.resolveMid(mblogId)
  const raw = await source.fetchPage(id, page)
  const rawLikers = raw.data.data ?? []

  const seen = new Set<string>()
  const likers: TweetLiker[] = []
  for (const item of rawLikers) {
    const liker = normalizeLiker(item)
    if (liker.id) {
      if (seen.has(liker.id))
        continue
      seen.add(liker.id)
    }
    likers.push(liker)
  }

  await source.emitNormalizeDone({ count: likers.length, durationMs: Date.now() - startAt })

  const total = raw.data.total_number
  const result: TweetLikersPageResult = {
    page: page + 1,
    // 上游没有「是否有下一页」字段：空页即到底；有 total 时以页码 × 本页条数估算。
    hasMore: likers.length > 0 && (total === undefined || page * rawLikers.length < total),
    likers,
  }
  if (total !== undefined)
    result.total = total
  return result
}

/**
 * 流式获取微博点赞者（page 游标 + 跨页按用户 id 去重）。
 *
 * 停止条件（任一命中）：空页（越界页 `data: null`）、整页重复、达到 `total_number`、`maxPages`。
 */
export async function* streamLikersFrom(
  source: TweetLikersSource,
  mblogId: string,
  options: TweetLikersStreamOptions = {},
): AsyncIterableIterator<TweetLiker> {
  const normalized = normalizeTweetIdInput(mblogId)
  const id = await source.resolveMid(normalized)
  const maxPages = normalizeLikerMaxPages(options.maxPages)
  const range = createStreamRange<TweetLiker>(options)
  const seen = new Set<string>()
  let page = normalizeLikerPage(options.page)
  let pages = 0
  let processed = 0
  let total: number | undefined

  while (pages < maxPages) {
    const result = await loadLikersPage(source, id, { page })
    pages += 1
    if (result.likers.length === 0)
      break

    const fresh = result.likers.filter((liker) => {
      if (!liker.id)
        return true
      if (seen.has(liker.id))
        return false
      seen.add(liker.id)
      return true
    })
    if (fresh.length === 0)
      break // 整页重复：上游忽略了 page

    for (const liker of fresh) {
      const decision = range.decide(liker)
      if (decision === 'stop')
        break
      if (decision === 'skip')
        continue
      processed += 1
      yield liker
    }

    if (result.total !== undefined)
      total = result.total

    const progress: TweetLikersStreamProgress = {
      mblogId: normalized,
      page,
      processed,
      pageSize: result.likers.length,
    }
    if (total !== undefined)
      progress.total = total

    try {
      await options.onProgress?.(progress)
    }
    catch {
      // 进度回调异常不影响流
    }

    if (range.stopped)
      break
    if (total !== undefined && processed >= total)
      break
    if (!result.hasMore)
      break
    page = result.page
  }
}
