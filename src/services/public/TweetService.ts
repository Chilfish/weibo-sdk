import type { BuildCommentsResponse, FriendstimelineResponse, MyMblogResponse, StatusShowResponse } from '../endpoints/tweet'
import type { IWeiboConfig } from '~/types/config'
import type { MyMBLog } from '~/types/raw/tweet/mymblog'
import { Tweet } from '~/models/data/Tweet'
import { buildCommentsSpec, friendstimelineSpec, myMblogSpec, statusShowSpec } from '../endpoints/tweet'
import { FetcherService } from '../internal/FetcherService'

let normalizeSeq = 0

export interface TweetPageResult {
  sinceId: number
  hasMore: boolean
  tweets: Tweet[]
}

export class TweetService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取用户微博列表（mymblog）
   *
   * 说明：这是最小可用实现，后续需要补齐分页参数、置顶/广告过滤、长文/转发解析等规则。
   */
  public async myMblog(uid: string, sinceId?: number, count?: number): Promise<MyMblogResponse> {
    const args: { uid: string, since_id?: number, count?: number } = { uid }
    if (typeof sinceId === 'number')
      args.since_id = sinceId
    if (typeof count === 'number')
      args.count = count
    return await this.request(myMblogSpec, args)
  }

  /**
   * 过滤掉广告等无效微博
   */
  private filterTweets(rawList: any[]): any[] {
    return rawList.filter(item => !item.isAd)
  }

  /**
   * 获取并归一化微博列表（最小字段）
   *
   * 支持两种调用方式：
   * - `listByUserId(uid, sinceId?)` —— 旧签名，兼容
   * - `listByUserId(uid, { sinceId?, count? })` —— 新签名，支持分页数
   */
  public async listByUserId(uid: string, sinceId?: number): Promise<TweetPageResult>
  public async listByUserId(uid: string, options?: { sinceId?: number, count?: number }): Promise<TweetPageResult>
  public async listByUserId(uid: string, sinceIdOrOptions?: number | { sinceId?: number, count?: number }): Promise<TweetPageResult> {
    let sinceId: number | undefined
    let count: number | undefined

    if (typeof sinceIdOrOptions === 'object') {
      sinceId = sinceIdOrOptions?.sinceId
      count = sinceIdOrOptions?.count
    }
    else {
      sinceId = sinceIdOrOptions
    }

    const traceId = `${Date.now()}-listByUserId-${++normalizeSeq}`
    const raw = await this.myMblog(uid, sinceId, count)
    const nextSinceId = Number(raw.data.since_id ?? 0)
    const filtered = this.filterTweets(raw.data.list || [])
    const hasMore = typeof raw.data.since_id === 'string' && raw.data.since_id.length > 0
      && raw.data.total > 0
      && filtered.length < raw.data.total
    const startAt = Date.now()
    const tweets = filtered.map(item => new Tweet(item))
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'Tweet',
      count: tweets.length,
      duration_ms: Date.now() - startAt,
    })
    return {
      sinceId: Number.isFinite(nextSinceId) ? nextSinceId : 0,
      hasMore,
      tweets,
    }
  }

  /**
   * 流式获取用户微博时间线
   *
   * 自动翻页直到无更多数据。
   *
   * @example
   * for await (const tweet of sdk.tweets.streamByUserId('1111681197')) {
   *   console.log(tweet.id, tweet.text)
   * }
   */
  async* streamByUserId(uid: string, options?: { count?: number }): AsyncIterableIterator<Tweet> {
    let cursor: number | undefined

    do {
      const page = await this.listByUserId(uid, { sinceId: cursor, count: options?.count })

      for (const tweet of page.tweets)
        yield tweet

      cursor = page.hasMore ? page.sinceId : undefined
    } while (cursor !== undefined)
  }

  /**
   * 获取单条微博详情
   *
   * `GET https://weibo.com/ajax/statuses/show?id=${mblogid}&isGetLongText=true`
   */
  public async show(mblogId: string, isGetLongText: boolean = true): Promise<StatusShowResponse> {
    return await this.request(statusShowSpec, { id: mblogId, isGetLongText })
  }

  /**
   * 获取并归一化单条微博详情
   */
  public async getByMblogId(mblogId: string, isGetLongText: boolean = true): Promise<Tweet> {
    const traceId = `${Date.now()}-getByMblogId-${++normalizeSeq}`
    const raw = await this.show(mblogId, isGetLongText)
    const startAt = Date.now()
    const tweet = new Tweet(raw)
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'Tweet',
      count: 1,
      duration_ms: Date.now() - startAt,
    })
    return tweet
  }

  /**
   * 获取微博评论列表
   *
   * `GET https://weibo.com/ajax/statuses/buildComments?id={mblogid}&count=10`
   *
   * @param mblogId 微博 ID
   * @param options 可选参数：max_id（分页游标）、count（每页数量）、flow（0=热度/1=时间）、uid
   */
  public async comments(mblogId: string, options?: {
    max_id?: number
    count?: number
    flow?: 0 | 1
    uid?: string
  }): Promise<BuildCommentsResponse> {
    const args: Record<string, string | number | boolean> = { id: mblogId }
    if (options?.max_id)
      args.max_id = options.max_id
    if (options?.count)
      args.count = options.count
    if (options?.flow !== undefined) {
      args.is_reload = 1
      args.flow = options.flow
      args.is_show_bulletin = 2
      args.is_mix = 0
      args.fetch_level = 0
    }
    if (options?.uid)
      args.uid = options.uid
    return await this.request(buildCommentsSpec, args as any)
  }

  /**
   * 获取首页 Feed（双向关注好友时间线）
   *
   * `GET https://weibo.com/ajax/feed/friendstimeline?since_id=0&count=25`
   */
  public async friendTimeline(options?: {
    since_id?: number
    count?: number
  }): Promise<FriendstimelineResponse> {
    const args: Record<string, number> = {}
    if (options?.since_id)
      args.since_id = options.since_id
    if (options?.count)
      args.count = options.count
    return await this.request(friendstimelineSpec, args as any)
  }

  /**
   * 获取并归一化首页 Feed
   */
  public async listFriendTimeline(options?: { since_id?: number, count?: number }): Promise<TweetPageResult> {
    const traceId = `${Date.now()}-friendTimeline-${++normalizeSeq}`
    const raw = await this.friendTimeline(options)
    const nextSinceId = raw.since_id ?? 0
    const filtered = this.filterTweets(raw.statuses || [])
    const hasMore = typeof raw.since_id === 'number' && raw.since_id > 0
      && (raw.total_number ?? 0) > 0
      && filtered.length < (raw.total_number ?? 0)
    const startAt = Date.now()
    const tweets = filtered.map(item => new Tweet(item))
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'Tweet',
      count: tweets.length,
      duration_ms: Date.now() - startAt,
    })
    return {
      sinceId: Number.isFinite(nextSinceId) ? nextSinceId : 0,
      hasMore,
      tweets,
    }
  }
}
