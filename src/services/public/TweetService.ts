import type { BuildCommentsArgs, BuildCommentsResponse, FriendstimelineArgs, FriendstimelineResponse, LongtextResponse, MyMblogResponse, RepostTimelineResponse, SearchProfileArgs, SearchProfileResponse, StatusShowResponse } from '../endpoints/tweet'
import type { RawTweet } from '~/models/data/Tweet'
import type { IWeiboConfig } from '~/types/config'
import { isRawTweet, Tweet } from '~/models/data/Tweet'
import { resolveTimeInput } from '~/utils/timeInput'
import { buildCommentsSpec, friendstimelineSpec, longtextSpec, myMblogSpec, repostTimelineSpec, searchProfileSpec, statusShowSpec } from '../endpoints/tweet'
import { FetcherService } from '../internal/FetcherService'

let normalizeSeq = 0

/**
 * 一页微博的归一化结果（`listByUserId` / `listFriendTimeline` 的返回值）。
 *
 * 两种游标互斥，按端点的分页机制填充：
 * - `page`：page 游标端点（mymblog），值为**下一页**页码
 * - `sinceId`：since_id 游标端点（friendstimeline），空串表示没有下一页
 */
export interface TweetPageResult {
  /** 下一页页码（page 游标端点，如 mymblog；无 page 游标时省略） */
  page?: number
  /** 下一页游标（since_id 游标端点，如 friendstimeline；空串 = 无更多） */
  sinceId?: string
  /** 是否可能还有下一页（`false` 时调用方可以停止翻页） */
  hasMore: boolean
  /** 本页归一化后的微博（已过滤广告等无效项） */
  tweets: Tweet[]
}

/**
 * `enrich` 的可选行为开关。
 */
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
  /** 归一化微博（与 `getByMblogId` 同构） */
  tweet: Tweet
  /** `statuses/show` 原始响应（passthrough，含未映射字段），供下游自行落盘 */
  raw: StatusShowResponse
  /** 长微博全文（仅 `includeLongText: true` 时请求；优先 `longTextContent_raw`） */
  longText?: string
}

/** 首页 Feed 默认关注分组 id（实测 friendstimeline 不带 list_id 会返回服务端 500） */
const DEFAULT_HOME_LIST_ID = '4665452701982436'

/**
 * 微博领域服务。
 *
 * 覆盖时间线（mymblog / friendstimeline）、单条详情、长文、评论、转发与按日期检索；
 * 每类能力都尽量提供「raw 方法 + 归一化方法」两个入口：
 *
 * - raw（`myMblog` / `show` / `friendTimeline` / `comments` …）：直接返回校验后的上游响应，已 deprecated
 * - 归一化（`listByUserId` / `streamByUserId` / `getByMblogId` / `listFriendTimeline` / `enrich`）：返回 `Tweet` / `TweetPageResult`
 *
 * 归一化方法会发出 `normalize_done` Wide Event，并在内部过滤广告等无效项。
 */
export class TweetService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
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
   * @returns mymblog 原始响应（`data.list` 含广告等需过滤项）
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
   *
   * 广告（`isAd`）等无效项会被过滤；`hasMore` 依据过滤后是否有内容判断
   * （mymblog 的 `total` 恒为 -1，不能作为依据）。
   *
   * @param uid 用户 UID
   * @param options 分页选项
   * @param options.page 页码（从 1 开始，缺省 1）
   * @param options.count 每页条数（缺省由上游决定）
   * @returns 归一化后的本页微博 + 下一页页码（`page` 为**下一页**页码）
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
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
   * 逐条产出归一化后的 `Tweet`；翻页依赖 `hasMore`，可用 `options.count` 调整每页条数。
   * 中途请求失败会直接抛错，已产出的条目由调用方自行保存（若需断点续传请用 `sdk.archive`）。
   *
   * @param uid 用户 UID
   * @param options 翻页选项
   * @param options.count 每页条数（缺省由上游决定）
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
   * @param mblogId 字母形式微博 id（如 `QqsYymYOS`）
   * @param isGetLongText 是否请求长文（默认 true，仅影响上游返回的长文标记，不额外发请求）
   * @returns 校验后的 `statuses/show` 响应（passthrough 保留未映射字段）
   * @deprecated F2 生熟双 API 收窄：公开使用请走归一化路径 `getByMblogId`
   */
  public async show(mblogId: string, isGetLongText: boolean = true): Promise<StatusShowResponse> {
    return await this.request(statusShowSpec, { id: mblogId, isGetLongText })
  }

  /**
   * 获取并归一化单条微博详情
   *
   * @param mblogId 字母形式微博 id
   * @param isGetLongText 是否请求长文（默认 true）
   * @returns `Tweet` 实例（与 `enrich` 的 `tweet` 字段同构）；同时发出 `normalize_done` 事件
   * @throws `WeiboAPINotOkError`（微博不存在 / 被删）/ `UnexpectedAPIResponseError` / 传输层错误
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
   * @param mblogId 字母形式微博 id
   * @param options `isGetLongText`（默认 true）；`includeLongText: true` 时额外请求 `longtext` 补拉全文（默认 false）
   * @returns `{ tweet, raw, longText? }`；`longText` 仅在 `includeLongText: true` 时有值
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

  /**
   * 获取微博评论列表 `GET /ajax/statuses/buildComments`
   *
   * 该端点对参数敏感：内部固定补齐 `is_reload=1` / `is_show_bulletin=2` / `is_mix=0`
   * / `type='feed'` / `fetch_level=0`，否则服务端返回 400「参数错误」。
   *
   * @param mblogId 字母形式微博 id
   * @param options 评论分页/过滤选项（全部可选）
   * @param options.max_id 上一页返回的分页游标（首屏省略）
   * @param options.count 每页条数
   * @param options.flow 排序方式（0 / 1，缺省由上游决定）
   * @param options.uid 以哪个用户视角读取（影响「我的赞」等字段）
   * @returns 校验后的评论响应；翻页游标为响应里的 `max_id`，用法见 `ArchiveService` 评论翻页实现
   */
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

  /**
   * 获取长微博全文 `GET /ajax/statuses/longtext`
   *
   * @param mblogId 字母形式微博 id
   * @returns 含 `data.longTextContent` / `data.longTextContent_raw` 的响应（前者已是 HTML 片段）
   */
  public async longText(mblogId: string): Promise<LongtextResponse> {
    return await this.request(longtextSpec, { id: mblogId })
  }

  /**
   * 获取微博转发列表 `GET /ajax/statuses/repostTimeline`
   *
   * 分页用 `page`（实测 `next_cursor` 参数无效，两页返回相同数据）。
   *
   * @param mblogId 原微博（字母形式 id）
   * @param options 分页选项
   * @param options.page 页码（从 1 开始；缺省 = 第一页）
   * @param options.count 每页条数
   * @returns 校验后的转发响应；`data` 为转发微博数组，`total_number` 为总数
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
   *
   * `starttime` / `endtime` 支持两种写法，请求前统一换算为**unix 秒**（上游只认秒，
   * 直接传日期字符串会被静默忽略）：
   * - 数字 / 纯数字字符串：按 unix 秒原样使用
   * - `YYYY-MM-DD` / `YYYYMMDD`：`starttime` 取当天 00:00:00、`endtime` 取当天 23:59:59
   *   （**运行环境本地时区**）
   *
   * 非法日期或无法识别的格式抛 `InvalidConfigError`（`CONFIG_INVALID`），不再静默透传。
   *
   * `has*` 系列过滤位（`0` / `1`）语义未经上游文档确认，默认不传即不加限制。
   *
   * @param uid 用户 UID
   * @param options 检索选项（全部可选）
   * @param options.page 页码（从 1 开始；缺省 = 第一页）
   * @param options.starttime 时间下界（unix 秒或日期字符串，含）
   * @param options.endtime 时间上界（unix 秒或日期字符串，含）
   * @param options.hasori 是否包含原创（0 / 1）
   * @param options.hasret 是否包含转发（0 / 1）
   * @param options.hastext 是否包含纯文字（0 / 1）
   * @param options.haspic 是否包含图片（0 / 1）
   * @param options.hasvideo 是否包含视频（0 / 1）
   * @param options.hasmusic 是否包含音乐（0 / 1）
   * @returns 校验后的 searchProfile 响应（`data.total` 为 number | string，需自行解析）
   */
  public async searchByDate(uid: string, options?: {
    page?: number
    starttime?: number | string
    endtime?: number | string
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
        args.starttime = resolveTimeInput(options.starttime, { boundary: 'start', field: 'starttime' })
      if (options.endtime !== undefined)
        args.endtime = resolveTimeInput(options.endtime, { boundary: 'end', field: 'endtime' })
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
   * 默认带上首页关注分组 `list_id`（上游缺省该参数会返回 500）。
   *
   * @param options Feed 选项（全部可选）
   * @param options.list_id 关注分组 id（默认首页分组）
   * @param options.since_id 分页游标（首屏省略）
   * @param options.count 每页条数
   * @param options.refresh 刷新标记（透传上游）
   * @returns 校验后的 friendstimeline 响应（`statuses` + `since_id` + `total_number`）
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
   *
   * `sinceId` 返回上游的下一页游标（`''` 表示没有下一页），`hasMore` 依据
   * `since_id > 0` 且本页条数小于 `total_number` 判断。
   *
   * @param options Feed 选项
   * @param options.since_id 上一页返回的游标（首屏省略）
   * @param options.count 每页条数
   * @returns 归一化后的本页微博 + 下一页游标（`sinceId`）
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
