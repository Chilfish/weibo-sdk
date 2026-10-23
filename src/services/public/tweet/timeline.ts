import type { MobileContainerResponse } from '../../endpoints/mobile'
import type { FriendstimelineArgs, FriendstimelineResponse, MyMblogResponse } from '../../endpoints/tweet'
import type { TweetFriendTimelineListOptions, TweetFriendTimelineStreamOptions, TweetPageResult, TweetUserTimelineListOptions, TweetUserTimelineStreamOptions } from './types'
import type { ITweet } from '~/types/domain/ITweet'
import { isRawTweet, Tweet } from '~/models/data/Tweet'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { normalizeMaxPages, paginate } from '~/utils/pagination'
import { createStreamRange } from '~/utils/streamRange'
import { extractMobileMblogs } from '../../endpoints/mobile'
import { filterRawTweets, MAX_FILTERED_PAGES, normalizeFeedCursor } from './helpers'

/** 用户时间线需要的低层数据源。 */
export interface TweetUserTimelineSource {
  authMode: 'cookie' | 'guest'
  fetchRawPage: (uid: string, page?: number, count?: number) => Promise<MyMblogResponse>
  fetchMobileContainer: (uid: string) => Promise<MobileContainerResponse>
  emitNormalizeDone: (params: { count: number, durationMs: number, traceId: string }) => Promise<void>
  newTraceId: (label: string) => string
}

/** 首页关注时间线需要的低层数据源。 */
export interface TweetFriendTimelineSource {
  request: (args: FriendstimelineArgs) => Promise<FriendstimelineResponse>
  emitNormalizeDone: (params: { count: number, durationMs: number, traceId: string }) => Promise<void>
  newTraceId: (label: string) => string
}

/** 获取并归一化一页用户微博（mymblog；guest 走 m 站第一页）。 */
export async function loadUserTimeline(
  source: TweetUserTimelineSource,
  uid: string,
  options?: TweetUserTimelineListOptions,
): Promise<TweetPageResult> {
  const { page, count } = options ?? {}
  const traceId = source.newTraceId('listByUserId')

  if (source.authMode === 'guest') {
    if (page !== undefined && page > 1) {
      throw new InvalidConfigError(
        'Guest mode can only read the first page of a user timeline; anonymous page 2 is login-gated.',
        { field: 'page', page, uid, guestPagination: 'first_page' },
      )
    }
    const startedAt = Date.now()
    const mobile = await source.fetchMobileContainer(uid)
    const rawTweets: unknown[] = extractMobileMblogs(mobile)
    const tweets = rawTweets.filter(isRawTweet).map(item => new Tweet(item))
    await source.emitNormalizeDone({ count: tweets.length, durationMs: Date.now() - startedAt, traceId })
    const total = mobile.data.cardlistInfo?.total
    return {
      hasMore: false,
      ...(total === undefined ? {} : { total }),
      partial: true,
      tweets,
    }
  }

  const raw = await source.fetchRawPage(uid, page, count)
  const rawList = raw.data.list ?? []
  const filtered = filterRawTweets(rawList)
  // hasMore 依据上游原始页判断：整页都是广告时仍有下一页，不能提前终止。
  const hasMore = rawList.length > 0
  const startAt = Date.now()
  const tweets = filtered.map(item => new Tweet(item))
  await source.emitNormalizeDone({ count: tweets.length, durationMs: Date.now() - startAt, traceId })
  return {
    page: (page ?? 1) + 1,
    hasMore,
    tweets,
  }
}

/** 流式遍历用户时间线（page 游标）。 */
export async function* streamUserTimelineFrom(
  source: TweetUserTimelineSource,
  uid: string,
  options: TweetUserTimelineStreamOptions = {},
): AsyncIterableIterator<ITweet> {
  const maxPages = normalizeMaxPages(options.maxPages)
  const range = createStreamRange<ITweet>(options, tweet => tweet.createdAt)
  let page = options.page !== undefined ? Math.max(1, Math.floor(options.page)) : 1
  let pages = 0
  let filteredPages = 0

  while (pages < maxPages) {
    const result = await loadUserTimeline(source, uid, { page, count: options.count })
    pages += 1

    if (result.tweets.length === 0) {
      // 整页都是广告 / 无效项时上游仍可能给下一页；只有空页（hasMore=false）才到底。
      if (!result.hasMore)
        break
      filteredPages += 1
      // 上游忽略 page 时会连续返回同一整页广告，达到上限即视为到底。
      if (filteredPages >= MAX_FILTERED_PAGES)
        break
      page = result.page ?? page + 1
      continue
    }
    filteredPages = 0

    for (const tweet of result.tweets) {
      const decision = range.decide(tweet)
      if (decision === 'stop')
        break
      if (decision === 'skip')
        continue
      yield tweet
    }

    if (range.stopped || !result.hasMore)
      break
    page = result.page ?? page + 1
  }
}

/** 获取并归一化一页首页「最新微博」关注时间线（`max_id` 游标）。 */
export async function loadFriendTimeline(
  source: TweetFriendTimelineSource,
  options?: TweetFriendTimelineListOptions,
): Promise<TweetPageResult> {
  const traceId = source.newTraceId('friendTimeline')
  const args: FriendstimelineArgs = {}
  if (options?.listId !== undefined)
    args.list_id = options.listId
  if (options?.fid !== undefined)
    args.fid = options.fid
  if (options?.maxId !== undefined)
    args.max_id = options.maxId
  if (options?.sinceId !== undefined)
    args.since_id = options.sinceId
  if (options?.count !== undefined)
    args.count = options.count
  if (options?.refresh !== undefined)
    args.refresh = options.refresh

  const raw = await source.request(args)
  const filtered = filterRawTweets(raw.statuses || [])
  const lastId = raw.statuses?.[raw.statuses.length - 1]?.id
  // 明确下发 max_id=0 / '' 表示到底，不能再用最后一条 status id 兜底（否则会多翻一页并重复）。
  const hasCursorField = raw.max_id !== undefined || raw.max_id_str !== undefined
  const nextMaxId = hasCursorField
    ? normalizeFeedCursor(raw.max_id) ?? normalizeFeedCursor(raw.max_id_str)
    : normalizeFeedCursor(lastId)
  const hasMore = filtered.length > 0
    && nextMaxId !== undefined
    && (options?.maxId === undefined || String(options.maxId) !== nextMaxId)
  const startAt = Date.now()
  const tweets = filtered.map(item => new Tweet(item))
  await source.emitNormalizeDone({ count: tweets.length, durationMs: Date.now() - startAt, traceId })

  const result: TweetPageResult = { hasMore, tweets }
  if (nextMaxId !== undefined)
    result.maxId = nextMaxId
  if (raw.total_number !== undefined)
    result.total = raw.total_number
  return result
}

/** 流式遍历首页关注时间线（`max_id` 游标 + 跨页 `mblogId` 去重）。 */
export async function* streamFriendTimelineFrom(
  source: TweetFriendTimelineSource,
  options: TweetFriendTimelineStreamOptions = {},
): AsyncIterableIterator<ITweet> {
  const range = createStreamRange<ITweet>(options, tweet => tweet.createdAt)

  if (options.sinceId !== undefined) {
    const page = await loadFriendTimeline(source, {
      sinceId: options.sinceId,
      listId: options.listId,
      fid: options.fid,
      count: options.count,
      refresh: options.refresh,
    })
    for (const tweet of page.tweets) {
      const decision = range.decide(tweet)
      if (decision === 'stop')
        break
      if (decision === 'skip')
        continue
      yield tweet
    }
    return
  }

  yield* paginate<ITweet, string>(async (cursor, page) => {
    const result = await loadFriendTimeline(source, {
      maxId: cursor,
      listId: options.listId,
      fid: options.fid,
      count: options.count,
      refresh: page === 1 ? options.refresh : undefined,
    })
    return {
      items: result.tweets,
      next: result.maxId,
      hasMore: result.hasMore,
      total: result.total,
    }
  }, {
    initialCursor: options.maxId === undefined ? undefined : String(options.maxId),
    maxPages: options.maxPages,
    maxItems: options.maxItems,
    since: options.since,
    until: options.until,
    getTime: tweet => tweet.createdAt,
    getKey: tweet => tweet.mblogId,
    onProgress: options.onProgress === undefined ? undefined : progress => options.onProgress!({
      page: progress.page,
      cursor: progress.cursor,
      processed: progress.processed,
      pageSize: progress.pageSize,
      total: progress.total,
    }),
  })
}
