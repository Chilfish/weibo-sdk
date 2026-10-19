import type { BuildCommentsArgs, BuildCommentsResponse, FriendstimelineArgs, FriendstimelineResponse, LongtextResponse, MyMblogResponse, RepostTimelineResponse, SearchProfileArgs, SearchProfileResponse, StatusShowResponse } from '../endpoints/tweet'
import type { RawTweet } from '~/models/data/Tweet'
import type { IWeiboConfig } from '~/types/config'
import { isRawTweet, Tweet } from '~/models/data/Tweet'
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

export interface TweetEnrichOptions {
  /** `statuses/show` 的 isGetLongText 参数（默认 true） */
  isGetLongText?: boolean
  /** 是否额外请求 `longtext` 端点补拉长微博全文（默认 false） */
  includeLongText?: boolean
}

/**
 * enrich 结果（P1-9）：raw 与归一化模型一起返回，调用方自行决定是否落盘。
 *
 * `raw` 保留 `statuses/show` 的 passthrough 字段（未被 `ITweet` 映射的字段也在），
 * `tweet` 与 `getByMblogId` 同构；二者都不改变 `ITweet` v1 契约。
 */
export interface TweetEnrichResult {
  tweet: Tweet
  raw: StatusShowResponse
  /** 长微博全文（仅 `includeLongText: true` 时请求；优先 `longTextContent_raw`） */
  longText?: string
}

/** 首页 Feed 默认关注分组 id（实测 friendstimeline 不带 list_id 会返回服务端 500） */
const DEFAULT_HOME_LIST_ID = '4665452701982436'

export class TweetService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取用户微博列表（mymblog，raw 响应）
   *
   * 说明：真实 API 自 2026-08 起分页从 `since_id` 漂移为 `page`（`since_id` 恒返回空串、
   * `total` 恒为 -1，翻到底时 `data.list` 为空数组）。归一化分页见 `listByUserId`。
   *
   * @param uid 用户 UID
   * @param page 页码（从 1 开始；缺省 = 第一页）
   * @param count 每页条数
   * @deprecated F2 生熟双 API 收窄：raw 方法仅为 `listByUserId` / `streamByUserId` 的
   * 数据源保留，公开使用请走归一化路径（`listByUserId` / `streamByUserId`）
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
   * 过滤掉广告等无效微博（E2：入参 `unknown[]`，经 `isRawTweet` 收窄为 `RawTweet`）
   */
  private filterTweets(rawList: unknown[]): RawTweet[] {
    return rawList.filter((item): item is RawTweet =>
      isRawTweet(item) && !(item as { isAd?: unknown }).isAd)
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
   * 获取单条微博详情（raw 响应）
   *
   * `GET https://weibo.com/ajax/statuses/show?id=${mblogid}&isGetLongText=true`
   *
   * @deprecated F2 生熟双 API 收窄：公开使用请走归一化路径 `getByMblogId`
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
   * 补拉单条微博：同时返回原始响应与归一化模型（P1-9）。
   *
   * 用于下游需要保存 raw、或仅需刷新单条微博媒体 URL 的场景。
   *
   * @example
   * const { tweet, raw, longText } = await sdk.tweets.enrich('QqsYymYOS', { includeLongText: true })
   * await saveRaw(tweet.mblogId, raw)
   */
  public async enrich(mblogId: string, options: TweetEnrichOptions = {}): Promise<TweetEnrichResult> {
    const traceId = `${Date.now()}-enrich-${++normalizeSeq}`
    const raw = await this.show(mblogId, options.isGetLongText ?? true)
    const startAt = Date.now()
    const tweet = new Tweet(raw)

    let longText: string | undefined
    if (options.includeLongText) {
      const response = await this.longText(mblogId)
      longText = response.data.longTextContent_raw ?? response.data.longTextContent
    }

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'Tweet',
      count: 1,
      duration_ms: Date.now() - startAt,
    })

    return { tweet, raw, longText }
  }

  /** 获取微博评论列表 `GET /ajax/statuses/buildComments` */
  public async comments(mblogId: string, options?: {
    max_id?: number
    count?: number
    flow?: 0 | 1
    uid?: string
  }): Promise<BuildCommentsResponse> {
    // 实测：buildComments 必须带这组参数，否则服务端返回 400「参数错误」
    const args: BuildCommentsArgs = {
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
    return await this.request(buildCommentsSpec, args)
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
    const args: SearchProfileArgs = { uid }
    if (options) {
      if (options.page !== undefined)
        args.page = options.page
      if (options.starttime !== undefined)
        args.starttime = options.starttime
      if (options.endtime !== undefined)
        args.endtime = options.endtime
      if (options.hasori !== undefined)
        args.hasori = options.hasori
      if (options.hasret !== undefined)
        args.hasret = options.hasret
      if (options.hastext !== undefined)
        args.hastext = options.hastext
      if (options.haspic !== undefined)
        args.haspic = options.haspic
      if (options.hasvideo !== undefined)
        args.hasvideo = options.hasvideo
      if (options.hasmusic !== undefined)
        args.hasmusic = options.hasmusic
    }
    return await this.request(searchProfileSpec, args)
  }

  /**
   * 获取首页 Feed（双向关注好友时间线，raw 响应）
   *
   * `GET https://weibo.com/ajax/feed/friendstimeline?since_id=0&count=25`
   *
   * @deprecated F2 生熟双 API 收窄：公开使用请走归一化路径 `listFriendTimeline`
   */
  public async friendTimeline(options?: {
    list_id?: string
    since_id?: string | number
    count?: number
    refresh?: number
  }): Promise<FriendstimelineResponse> {
    const args: FriendstimelineArgs = {
      list_id: options?.list_id ?? DEFAULT_HOME_LIST_ID,
    }
    if (options?.since_id !== undefined)
      args.since_id = options.since_id
    if (options?.count !== undefined)
      args.count = options.count
    if (options?.refresh !== undefined)
      args.refresh = options.refresh
    return await this.request(friendstimelineSpec, args)
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
