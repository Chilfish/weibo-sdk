import type { BuildCommentsResponse, FriendstimelineResponse, LongtextResponse, MyMblogResponse, RepostTimelineResponse, SearchProfileResponse, StatusShowResponse } from '../endpoints/tweet'
import type { IWeiboConfig } from '~/types/config'
import { Tweet } from '~/models/data/Tweet'
import { buildCommentsSpec, friendstimelineSpec, longtextSpec, myMblogSpec, repostTimelineSpec, searchProfileSpec, statusShowSpec } from '../endpoints/tweet'
import { FetcherService } from '../internal/FetcherService'

let normalizeSeq = 0

export interface TweetPageResult {
  /** 下一页页码（page 游标端点，如 mymblog；无 page 游标时省略） */
  page?: number
  /** 下一页游标（since_id 游标端点，如 friendstimeline；空串 = 无更多） */
  sinceId?: string
  hasMore: boolean
  tweets: Tweet[]
}

/** 首页 Feed 默认关注分组 id（实测 friendstimeline 不带 list_id 会返回服务端 500） */
const DEFAULT_HOME_LIST_ID = '4665452701982436'

export class TweetService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取用户微博列表（mymblog）
   *
   * 说明：真实 API 自 2026-08 起分页从 `since_id` 漂移为 `page`（`since_id` 恒返回空串、
   * `total` 恒为 -1，翻到底时 `data.list` 为空数组）。归一化分页见 `listByUserId`。
   *
   * @param uid 用户 UID
   * @param page 页码（从 1 开始；缺省 = 第一页）
   * @param count 每页条数
   */
  public async myMblog(uid: string, page?: number, count?: number): Promise<MyMblogResponse> {
    const args: { uid: string, page?: number, count?: number } = { uid }
    if (page !== undefined)
      args.page = page
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
   * 获取并归一化微博列表（最小字段，page 游标）
   *
   * 支持两种调用方式：
   * - `listByUserId(uid)` —— 第一页
   * - `listByUserId(uid, { page?, count? })` —— 指定页/每页条数
   */
  public async listByUserId(uid: string, options?: { page?: number, count?: number }): Promise<TweetPageResult> {
    const { page, count } = options ?? {}
    const traceId = `${Date.now()}-listByUserId-${++normalizeSeq}`
    const raw = await this.myMblog(uid, page, count)
    const filtered = this.filterTweets(raw.data.list || [])
    const hasMore = filtered.length > 0
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
      page: (page ?? 1) + 1,
      hasMore,
      tweets,
    }
  }

  /**
   * 流式获取用户微博时间线
   *
   * 自动翻页直到无更多数据（mymblog page 游标）。
   *
   * @example
   * for await (const tweet of sdk.tweets.streamByUserId('1111681197')) {
   *   console.log(tweet.id, tweet.text)
   * }
   */
  async* streamByUserId(uid: string, options?: { count?: number }): AsyncIterableIterator<Tweet> {
    let page = 1

    do {
      const result = await this.listByUserId(uid, { page, count: options?.count })

      for (const tweet of result.tweets)
        yield tweet

      if (!result.hasMore)
        break
      page = result.page ?? page + 1
    } while (true)
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

  /** 获取微博评论列表 `GET /ajax/statuses/buildComments` */
  public async comments(mblogId: string, options?: {
    max_id?: number
    count?: number
    flow?: 0 | 1
    uid?: string
  }): Promise<BuildCommentsResponse> {
    // 实测：buildComments 必须带这组参数，否则服务端返回 400「参数错误」
    const args: Record<string, string | number | boolean> = {
      id: mblogId,
      is_reload: 1,
      is_show_bulletin: 2,
      is_mix: 0,
      type: 'feed',
      fetch_level: 0,
    }
    if (options?.max_id)
      args.max_id = options.max_id
    if (options?.count)
      args.count = options.count
    if (options?.flow !== undefined)
      args.flow = options.flow
    if (options?.uid)
      args.uid = options.uid
    return await this.request(buildCommentsSpec, args as any)
  }

  /** 获取长微博全文 `GET /ajax/statuses/longtext` */
  public async longText(mblogId: string): Promise<LongtextResponse> {
    return await this.request(longtextSpec, { id: mblogId })
  }

  /**
   * 获取微博转发列表 `GET /ajax/statuses/repostTimeline`
   *
   * 分页用 `page`（实测 `next_cursor` 参数无效，两页返回相同数据）。
   */
  public async getReposts(mblogId: string, options?: { page?: number, count?: number }): Promise<RepostTimelineResponse> {
    const args: { id: string, page?: number, count?: number } = { id: mblogId }
    if (options?.page !== undefined)
      args.page = options.page
    if (options?.count !== undefined)
      args.count = options.count
    return await this.request(repostTimelineSpec, args)
  }

  /**
   * 按日期范围搜索用户微博 GET /ajax/statuses/searchProfile
   */
  public async searchByDate(uid: string, options?: {
    page?: number
    starttime?: string
    endtime?: string
    hasori?: number
    hasret?: number
    hastext?: number
    haspic?: number
    hasvideo?: number
    hasmusic?: number
  }): Promise<SearchProfileResponse> {
    const args: Record<string, string | number> = { uid }
    if (options) {
      for (const [k, v] of Object.entries(options)) {
        if (v !== undefined)
          args[k] = v
      }
    }
    return await this.request(searchProfileSpec, args as any)
  }

  /**
   * 获取首页 Feed（双向关注好友时间线）
   *
   * `GET https://weibo.com/ajax/feed/friendstimeline?since_id=0&count=25`
   */
  public async friendTimeline(options?: {
    list_id?: string
    since_id?: string | number
    count?: number
    refresh?: number
  }): Promise<FriendstimelineResponse> {
    const args: Record<string, string | number> = {
      list_id: options?.list_id ?? DEFAULT_HOME_LIST_ID,
    }
    if (options?.since_id !== undefined)
      args.since_id = options.since_id
    if (options?.count !== undefined)
      args.count = options.count
    if (options?.refresh !== undefined)
      args.refresh = options.refresh
    return await this.request(friendstimelineSpec, args as any)
  }

  /**
   * 获取并归一化首页 Feed
   */
  public async listFriendTimeline(options?: { since_id?: string | number, count?: number }): Promise<TweetPageResult> {
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
      sinceId: nextSinceId > 0 ? String(nextSinceId) : '',
      hasMore,
      tweets,
    }
  }
}
