import type { SearchProfileResponse, StatusShowResponse } from '../../endpoints/tweet'
import type { TweetEnrichOptions, TweetEnrichResult, TweetSearchByDateOptions, TweetSearchByDatePageResult } from './types'
import type { ITweet, TweetLongText } from '~/types/domain/ITweet'
import { Tweet } from '~/models/data/Tweet'
import { normalizeTweetIdInput } from '~/utils/tweetId'
import { parseSearchTotal } from './helpers'

/** 单条详情 / enrich 需要的数据源。 */
export interface TweetDetailSource {
  fetchRawStatus: (mblogId: string, isGetLongText?: boolean) => Promise<StatusShowResponse>
  longText: (mblogId: string) => Promise<TweetLongText>
  emitNormalizeDone: (params: { count: number, durationMs: number, traceId: string }) => Promise<void>
  newTraceId: (label: string) => string
}

/** 获取并归一化单条微博详情。 */
export async function loadTweetDetail(
  source: TweetDetailSource,
  mblogId: string,
  isGetLongText: boolean = true,
): Promise<ITweet> {
  const traceId = source.newTraceId('getByMblogId')
  const raw = await source.fetchRawStatus(mblogId, isGetLongText)
  const startAt = Date.now()
  const tweet = new Tweet(raw)
  await source.emitNormalizeDone({ count: 1, durationMs: Date.now() - startAt, traceId })
  return tweet
}

/** 补拉单条微博：raw 与归一化模型一起返回，可选补长文。 */
export async function enrichTweet(
  source: TweetDetailSource,
  mblogId: string,
  options: TweetEnrichOptions = {},
): Promise<TweetEnrichResult> {
  const traceId = source.newTraceId('enrich')
  const id = normalizeTweetIdInput(mblogId)
  // 长文与详情互不依赖，同时发出；两者都只依赖归一化后的 id。
  const [raw, longTextResponse] = await Promise.all([
    source.fetchRawStatus(id, options.isGetLongText ?? true),
    options.includeLongText ? source.longText(id) : undefined,
  ])
  const startAt = Date.now()
  const tweet = new Tweet(raw)
  const longText = longTextResponse?.text
  await source.emitNormalizeDone({ count: 1, durationMs: Date.now() - startAt, traceId })
  return { tweet, raw, longText }
}

/** 按日期范围检索用户微博（归一化）。`hasMore` 依据上游 `total` 与本页条数估算。 */
export function loadSearchByDatePage(
  raw: SearchProfileResponse,
  options?: TweetSearchByDateOptions,
): TweetSearchByDatePageResult {
  const page = options?.page !== undefined && Number.isFinite(options.page) ? Math.max(1, Math.floor(options.page)) : 1
  const tweets = raw.data.list.map(item => new Tweet(item))
  const total = parseSearchTotal(raw.data.total)
  const result: TweetSearchByDatePageResult = {
    tweets,
    page,
    hasMore: tweets.length > 0 && (total === undefined || page * tweets.length < total),
  }
  if (total !== undefined)
    result.total = total
  return result
}
