import type { RepostTimelineResponse } from '../../endpoints/tweet'
import type { TweetRepostsListOptions, TweetRepostsPageResult, TweetRepostsStreamOptions, TweetRepostsStreamProgress } from './types'
import type { ITweet } from '~/types/domain/ITweet'
import { Tweet } from '~/models/data/Tweet'
import { normalizeMaxPages } from '~/utils/pagination'
import { createStreamRange } from '~/utils/streamRange'
import { normalizeTweetIdInput } from '~/utils/tweetId'

/** `getReposts` / `streamReposts` 需要的数据源。 */
export interface TweetRepostsSource {
  fetchPage: (mblogId: string, options?: TweetRepostsListOptions) => Promise<RepostTimelineResponse>
}

/** 获取并归一化一页转发（`page` 游标）。 */
export async function loadRepostsPage(
  source: TweetRepostsSource,
  mblogId: string,
  options?: TweetRepostsListOptions,
): Promise<TweetRepostsPageResult> {
  const raw = await source.fetchPage(mblogId, options)
  const page = options?.page !== undefined && Number.isFinite(options.page) ? Math.max(1, Math.floor(options.page)) : 1
  const reposts = (raw.data ?? []).map(item => new Tweet(item))
  const result: TweetRepostsPageResult = {
    reposts,
    page,
    hasMore: reposts.length > 0 && (raw.max_page === undefined || page < raw.max_page),
  }
  if (raw.total_number !== undefined)
    result.total = raw.total_number
  if (raw.max_page !== undefined)
    result.maxPage = raw.max_page
  return result
}

/** 流式遍历一条微博的转发（page 游标 + 按转发微博 mblogId 去重）。 */
export async function* streamRepostsFrom(
  source: TweetRepostsSource,
  mblogId: string,
  options: TweetRepostsStreamOptions = {},
): AsyncIterableIterator<ITweet> {
  const normalized = normalizeTweetIdInput(mblogId)
  const maxPages = normalizeMaxPages(options.maxPages)
  const range = createStreamRange<ITweet>(options, tweet => tweet.createdAt)
  const seen = new Set<string>()
  let page = options.page !== undefined ? Math.max(1, Math.floor(options.page)) : 1
  let pages = 0
  let processed = 0

  while (pages < maxPages) {
    const raw = await source.fetchPage(normalized, { page, count: options.count })
    pages += 1

    const items = raw.data ?? []
    if (items.length === 0)
      break

    const fresh: typeof items = []
    for (const item of items) {
      if (item.mblogid) {
        if (seen.has(item.mblogid))
          continue
        seen.add(item.mblogid)
      }
      fresh.push(item)
    }
    if (fresh.length === 0)
      break

    for (const item of fresh) {
      const tweet = new Tweet(item)
      const decision = range.decide(tweet)
      if (decision === 'stop')
        break
      if (decision === 'skip')
        continue
      processed += 1
      yield tweet
    }

    const progress: TweetRepostsStreamProgress = {
      mblogId: normalized,
      page,
      processed,
      pageSize: items.length,
      total: raw.total_number,
    }
    try {
      await options.onProgress?.(progress)
    }
    catch {
      // 进度回调异常不影响流
    }

    if (range.stopped)
      break
    if (raw.total_number !== undefined && raw.total_number > 0 && processed >= raw.total_number)
      break
    page += 1
  }
}
