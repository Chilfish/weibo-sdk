import type { BuildCommentsArgs, BuildCommentsResponse, FriendstimelineArgs, FriendstimelineResponse, LongtextResponse, MyMblogResponse, RepostTimelineResponse, SearchProfileArgs, SearchProfileResponse, StatusShowResponse } from '../endpoints/tweet'
import type { TweetContextDeps, TweetContextOptions } from './tweet/context'
import type {
  TweetCommentsOptions,
  TweetCommentsPageResult,
  TweetCommentsStreamOptions,
  TweetEnrichOptions,
  TweetEnrichResult,
  TweetFriendTimelineListOptions,
  TweetFriendTimelineStreamOptions,
  TweetLikersOptions,
  TweetLikersPageResult,
  TweetLikersStreamOptions,
  TweetLikersStreamProgress,
  TweetPageResult,
  TweetRepliesOptions,
  TweetRepostsListOptions,
  TweetRepostsPageResult,
  TweetRepostsStreamOptions,
  TweetSearchByDateOptions,
  TweetSearchByDatePageResult,
  TweetUserTimelineListOptions,
  TweetUserTimelineStreamOptions,
} from './tweet/types'
import type { IWeiboConfig } from '~/types/config'
import type { TweetLiker } from '~/types/domain/ILiker'
import type { ITweet, ITweetComment, TweetLongText } from '~/types/domain/ITweet'
import type { ITweetContext } from '~/types/domain/ITweetContext'
import { isRawTweet, normalizeComment, normalizeLiker, normalizeLongText, Tweet } from '~/models/data/Tweet'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { normalizeMaxPages, paginate } from '~/utils/pagination'
import { createStreamRange } from '~/utils/streamRange'
import { resolveTimeInput } from '~/utils/timeInput'
import { normalizeTweetIdInput } from '~/utils/tweetId'
import { likersSpec } from '../endpoints/likers'
import { extractMobileMblogs, mobileContainerSpec } from '../endpoints/mobile'
import { buildCommentsSpec, friendstimelineSpec, longtextSpec, myMblogSpec, repostTimelineSpec, searchProfileSpec, statusShowSpec } from '../endpoints/tweet'
import { FetcherService } from '../internal/FetcherService'
import { loadTweetContext } from './tweet/context'
import { commentsPageFromRaw, filterRawTweets, MAX_FILTERED_PAGES, normalizeFeedCursor, normalizeLikerMaxPages, normalizeLikerPage, parseSearchTotal } from './tweet/helpers'

export type { TweetContextDeps, TweetContextOptions } from './tweet/context'
export type {
  TweetCommentsOptions,
  TweetCommentsPageResult,
  TweetCommentsStreamOptions,
  TweetCommentsStreamProgress,
  TweetEnrichOptions,
  TweetEnrichResult,
  TweetFriendTimelineListOptions,
  TweetFriendTimelineStreamOptions,
  TweetFriendTimelineStreamProgress,
  TweetLikersOptions,
  TweetLikersPageResult,
  TweetLikersStreamOptions,
  TweetLikersStreamProgress,
  TweetPageResult,
  TweetRepliesOptions,
  TweetRepostsListOptions,
  TweetRepostsPageResult,
  TweetRepostsStreamOptions,
  TweetRepostsStreamProgress,
  TweetSearchByDateOptions,
  TweetSearchByDatePageResult,
  TweetUserTimelineListOptions,
  TweetUserTimelineStreamOptions,
} from './tweet/types'

let normalizeSeq = 0

/**
 * 微博领域服务。
 *
 * 覆盖时间线（mymblog / friendstimeline）、单条详情、长文、评论、转发与按日期检索；
 * 公开面以归一化方法为主：
 *
 * - 时间线：`listByUserId` / `streamByUserId` / `listFriendTimeline` / `streamFriendTimeline`
 * - 单条：`getByMblogId` / `enrich` / `context`
 * - 评论与转发：`comments` / `streamComments` / `replies` / `streamReplies` / `getReposts` / `streamReposts`
 *
 * `fetchRawUserTimelinePage` 是归档层使用的低层 raw 数据源。
 * 归一化方法会发出 `normalize_done` Wide Event，并在内部过滤广告等无效项。
 */
export class TweetService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   * @param contextDeps `context()` 的跨领域依赖（作者资料），由 `WeiboSDK` 注入
   */
  constructor(
    config: IWeiboConfig,
    deps?: ConstructorParameters<typeof FetcherService>[1],
    private readonly contextDeps: TweetContextDeps = {},
  ) {
    super(config, deps)
  }

  /**
   * 拉取一页用户微博原始响应（mymblog，低层数据源）
   *
   * 说明：mymblog 曾在 2026-08 把分页从 `since_id` 漂移为 `page`（`since_id` 恒空串、`total` 恒 -1）；
   * 2026-10-20 实测两种游标均可用且等价（`since_id` 为 number 或带后缀的 string，`total` 为真实值）。
   * 归一化分页仍以 `page` 为主，避免大 ID 在后缀形态下丢失。翻到底时 `data.list` 为空数组。
   *
   * 归档层依赖该原始页生成 `schemaDigest`；普通读取请用 `listByUserId` / `streamByUserId`。
   *
   * @param uid 用户 UID
   * @param page 页码（从 1 开始；缺省 = 第一页）
   * @param count 每页条数
   * @returns mymblog 原始响应（`data.list` 含广告等需过滤项）
   */
  public async fetchRawUserTimelinePage(uid: string, page?: number, count?: number): Promise<MyMblogResponse> {
    const args: { uid: string, page?: number, count?: number } = { uid }
    if (page !== undefined)
      args.page = page
    if (typeof count === 'number')
      args.count = count
    return await this.request(myMblogSpec, args)
  }

  /**
   * 获取并归一化微博列表（最小字段，page 游标）
   *
   * 支持两种调用方式：
   * - `listByUserId(uid)` —— 第一页
   * - `listByUserId(uid, { page?, count? })` —— 指定页/每页条数
   *
   * 广告（`isAd`）等无效项会被过滤；`hasMore` 依据过滤后是否有内容判断
   * （不依赖 `total`：其形态在 -1 与真实总数之间漂移过）。
   *
   * @param uid 用户 UID
   * @param options 分页选项
   * @param options.page 页码（从 1 开始，缺省 1）
   * @param options.count 每页条数（缺省由上游决定）
   * @returns 归一化后的本页微博 + 下一页页码（`page` 为**下一页**页码）
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async listByUserId(uid: string, options?: TweetUserTimelineListOptions): Promise<TweetPageResult> {
    const { page, count } = options ?? {}
    const traceId = `${Date.now()}-listByUserId-${++normalizeSeq}`

    if (this.authMode === 'guest') {
      if (page !== undefined && page > 1) {
        throw new InvalidConfigError(
          'Guest mode can only read the first page of a user timeline; anonymous page 2 is login-gated.',
          { field: 'page', page, uid, guestPagination: 'first_page' },
        )
      }
      const startedAt = Date.now()
      const mobile = await this.request(mobileContainerSpec, { containerid: `107603${uid}` })
      const rawTweets: unknown[] = extractMobileMblogs(mobile)
      const tweets = rawTweets.filter(isRawTweet).map(item => new Tweet(item))
      await this.emitTelemetry({
        event_name: 'normalize_done',
        timestamp: Date.now(),
        trace_id: traceId,
        model: 'Tweet',
        count: tweets.length,
        duration_ms: Date.now() - startedAt,
      })
      const total = mobile.data.cardlistInfo?.total
      return {
        hasMore: false,
        ...(total === undefined ? {} : { total }),
        partial: true,
        tweets,
      }
    }

    const raw = await this.fetchRawUserTimelinePage(uid, page, count)
    const rawList = raw.data.list ?? []
    const filtered = filterRawTweets(rawList)
    // hasMore 依据上游原始页判断：整页都是广告时仍有下一页，不能提前终止。
    const hasMore = rawList.length > 0
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
   * `maxItems` 限制总条数；时间倒序的流可用 `since` / `until` 按日期早停。
   * 中途请求失败会直接抛错，已产出的条目由调用方自行保存（若需断点续传请用 `sdk.archive`）。
   *
   * @param uid 用户 UID
   * @param options 翻页 / 范围选项
   * @param options.page 起始页码（从 1 开始，缺省 1）
   * @param options.count 每页条数（缺省由上游决定）
   * @param options.maxPages 最多翻页数（默认不限）
   * @param options.maxItems 最多产出条数（默认不限）
   * @param options.since 时间下界（含当天）；更早的条目停止翻页
   * @param options.until 时间上界（含当天）；更晚的条目跳过
   *
   * @example
   * for await (const tweet of sdk.tweets.streamByUserId('1111681197')) {
   *   console.log(tweet.id, tweet.text)
   * }
   */
  async* streamByUserId(uid: string, options: TweetUserTimelineStreamOptions = {}): AsyncIterableIterator<ITweet> {
    const maxPages = normalizeMaxPages(options.maxPages)
    const range = createStreamRange<ITweet>(options, tweet => tweet.createdAt)
    let page = options.page !== undefined ? Math.max(1, Math.floor(options.page)) : 1
    let pages = 0
    let filteredPages = 0

    while (pages < maxPages) {
      const result = await this.listByUserId(uid, { page, count: options.count })
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

  /**
   * 拉取单条微博原始响应（低层数据源，供归一化 / enrich / context 使用）
   *
   * `GET https://weibo.com/ajax/statuses/show?id=${mblogid}&isGetLongText=true`
   *
   * @param mblogId 微博 id：mblogId / 数字 mid / 微博状态 URL（自动归一化）
   * @param isGetLongText 是否请求长文（默认 true，仅影响上游返回的长文标记，不额外发请求）
   */
  private async fetchRawStatus(mblogId: string, isGetLongText: boolean = true): Promise<StatusShowResponse> {
    return await this.request(statusShowSpec, { id: normalizeTweetIdInput(mblogId), isGetLongText })
  }

  /**
   * 获取并归一化单条微博详情
   *
   * @param mblogId 微博 id：mblogId / 数字 mid / 微博状态 URL（自动归一化）
   * @param isGetLongText 是否请求长文（默认 true）
   * @returns 归一化微博（与 `enrich` 的 `tweet` 字段同构）；同时发出 `normalize_done` 事件
   * @throws `WeiboAPINotOkError`（微博不存在 / 被删）/ `UnexpectedAPIResponseError` / 传输层错误
   */
  public async getByMblogId(mblogId: string, isGetLongText: boolean = true): Promise<ITweet> {
    const traceId = `${Date.now()}-getByMblogId-${++normalizeSeq}`
    const raw = await this.fetchRawStatus(mblogId, isGetLongText)
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
   * @param mblogId 微博 id：mblogId / 数字 mid / 微博状态 URL（自动归一化）
   * @param options `isGetLongText`（默认 true）；`includeLongText: true` 时额外请求 `longtext` 补拉全文（默认 false）
   * @returns `{ tweet, raw, longText? }`；`longText` 仅在 `includeLongText: true` 时有值
   *
   * @example
   * const { tweet, raw, longText } = await sdk.tweets.enrich('QqsYymYOS', { includeLongText: true })
   * await saveRaw(tweet.mblogId, raw)
   */
  public async enrich(mblogId: string, options: TweetEnrichOptions = {}): Promise<TweetEnrichResult> {
    const traceId = `${Date.now()}-enrich-${++normalizeSeq}`
    const id = normalizeTweetIdInput(mblogId)
    // 长文与详情互不依赖，同时发出；两者都只依赖归一化后的 id。
    const [raw, longTextResponse] = await Promise.all([
      this.fetchRawStatus(id, options.isGetLongText ?? true),
      options.includeLongText ? this.longText(id) : undefined,
    ])
    const startAt = Date.now()
    const tweet = new Tweet(raw)

    const longText = longTextResponse?.text

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
   * 构造 Agent 视角的单条微博上下文（`weibo.tweet-context/v1`）。
   *
   * 与 `ITweet` 的区别：`ITweet` 忠实保留记录；本方法把「谁说的 / 什么时候 /
   * 当前作者说了什么 / 配了什么 / 和谁有关 / 哪些是未知」显式化。纯投影在
   * `buildTweetContext` 中完成，本方法只负责按需补数据。
   *
   * 语义要点：
   * - 转发微博的 `post.text` 只取当前作者（`repostChain[0]`），不是拍平的 `//@` 链；
   * - `mentions` 只保留当前作者正文里的 @；
   * - 当前微博的媒体与转发的原微博媒体分开归属；
   * - 不调用任何 LLM；OCR / 视觉描述 / 转写由调用方回填。
   *
   * @param mblogId 微博 id：mblogId / 数字 mid / 微博状态 URL（自动归一化）
   * @param options 是否补作者 / 长文 / 评论，以及文本与媒体上限
   * @returns Agent 视角上下文
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   *
   * @example
   * const context = await sdk.tweets.context('QqsYymYOS', {
   *   comments: 5,
   *   maxChars: 4000,
   * })
   * console.log(context.post.text)
   * console.log(context.media.map(media => media.url))
   */
  public async context(mblogId: string, options: TweetContextOptions = {}): Promise<ITweetContext> {
    return await loadTweetContext({
      fetchRawStatus: (id, isGetLongText) => this.fetchRawStatus(id, isGetLongText),
      longText: id => this.longText(id),
      streamComments: (id, streamOptions) => this.streamComments(id, streamOptions),
    }, this.contextDeps, mblogId, options)
  }

  /**
   * 评论接口的 id 归一化：`flow=1`（按时间）要求数字 mid，字母 mblogId 会被上游 400。
   * 默认热度序（flow=0）两种形态都可用，所以只在需要时多请求一次 `statuses/show`。
   * 二级评论路径的 `id` 本身就是数字评论 id，不做解析。
   */
  private async resolveCommentsId(
    id: string,
    options?: { flow?: 0 | 1, isReply?: number },
  ): Promise<string> {
    const normalized = normalizeTweetIdInput(id)
    if (options?.flow !== 1 || options.isReply === 1 || /^\d+$/.test(normalized))
      return normalized
    return await this.resolveTweetMid(normalized)
  }

  /**
   * 把任意微博 id 输入解析为数字 mid（`statuses/show` 兜底）。
   *
   * 点赞者等端点只接受数字 mid；mblogId / 微博 URL 需要先解析一次。
   * 已经是纯数字时直接返回，不产生额外请求。
   */
  private async resolveTweetMid(input: string): Promise<string> {
    const normalized = normalizeTweetIdInput(input)
    if (/^\d+$/.test(normalized))
      return normalized

    const raw = await this.fetchRawStatus(normalized, false)
    const mid = raw.idstr ?? (raw.id === undefined ? undefined : String(raw.id))
    if (!mid) {
      throw new UnexpectedAPIResponseError('statuses/show did not return a numeric mid.', {
        endpoint: 'ajax/statuses/show',
        args: { id: normalized },
      })
    }
    return mid
  }

  /**
   * 获取微博评论列表 `GET /ajax/statuses/buildComments`
   *
   * 2026-10-20 真实浏览器抓包确认的参数事实：
   * - 固定补齐 `is_reload=1` / `is_show_bulletin=2` / `is_mix=0` / `fetch_level=0`；
   * - **不要传 `type=feed`**：带上它首屏只返回 3 条（`total_number` / `max_id` 仍正常，
   *   属于静默降级）；浏览器真实请求不带该参数，首屏返回 20 条；
   * - `count` 被上游忽略（传 10 / 20 均返回 20 条）；
   * - `flow=1`（按时间）要求 `id` 为**数字 mid**，传字母 mblogId 会 HTTP 400；
   *   本方法会在 `flow=1` 且入参非数字时自动用 `statuses/show` 解析 mid；
   * - 翻页必须使用响应顶层的 `max_id`；不要把「最后一条评论的 id」当游标；
   * - 顶层评论的 `total_number` 包含楼中楼（以及可能不可见的评论），不能用它判断剩余条数。
   *
   * @param mblogId 微博 id：mblogId / 数字 mid / 微博状态 URL（自动归一化）；
   *   读取二级评论时直接传一级评论 id（见 `replies`）
   * @param options 评论分页/过滤选项（全部可选）
   * @param options.maxId 上一页返回的分页游标（首屏省略；来自响应顶层 `max_id`）
   * @param options.count 每页条数（上游忽略）
   * @param options.flow 排序方式（0=热度 / 1=时间；时间序必须使用数字 mid，方法内自动解析）
   * @param options.uid 以哪个用户视角读取（影响「我的赞」等字段）
   * @param options.isReply 是否读取二级评论（1 = 是；此时 `mblogId` 必须是一级评论 id）
   * @param options.rootId 可选透传；二级评论不需要（真实请求用 `id=<一级评论 id>`）
   * @param options.fetchLevel 拉取层级（0 = 一级评论，1 = 二级评论）
   * @returns 校验后的评论响应；`max_id === 0` 或空页即到底
   */
  public async fetchRawComments(mblogId: string, options?: TweetCommentsOptions): Promise<BuildCommentsResponse> {
    const id = await this.resolveCommentsId(mblogId, options)
    const args: BuildCommentsArgs = {
      id,
      is_reload: 1,
      is_show_bulletin: 2,
      is_mix: 0,
      fetch_level: options?.fetchLevel ?? 0,
    }
    if (options?.maxId)
      args.max_id = options.maxId
    if (options?.count)
      args.count = options.count
    if (options?.flow !== undefined)
      args.flow = options.flow
    if (options?.uid)
      args.uid = options.uid
    if (options?.isReply !== undefined)
      args.is_reply = options.isReply
    if (options?.rootId !== undefined)
      args.rootid = options.rootId
    return await this.request(buildCommentsSpec, args)
  }

  /**
   * 获取一条一级评论下的二级评论（D13，`is_reply=1` + `rootid`）。
   *
   * **真实请求的 `id` 必须是一级评论 id，不是微博 mblogid**（2026-10-20 实测：
   * 传字母 mblogid 会返回 HTTP 400「parameter (id)'s value invalid」）。因此本方法
   * 用 `rootCommentId` 作为 `id`；`mblogId` 仅用于调用方上下文 / 进度标识。
   * 分页仍用响应里的 `max_id`（`max_id === 0` 即到底）。
   *
   * @param _mblogId 微博 mblogId（仅调用上下文，不进入请求）
   * @param rootCommentId 一级评论 id（`ITweetComment.id` / `idstr`）
   * @param options 分页 / 排序选项
   * @param options.maxId 上一页返回的分页游标（首屏省略）
   * @param options.count 每页条数
   * @param options.flow 排序方式（0 / 1）
   * @param options.uid 以哪个用户视角读取
   */
  public async fetchRawReplies(_mblogId: string, rootCommentId: string, options?: TweetRepliesOptions): Promise<BuildCommentsResponse> {
    return await this.fetchRawComments(rootCommentId, {
      ...options,
      isReply: 1,
      fetchLevel: 1,
    })
  }

  /**
   * 获取微博评论列表（归一化）。
   *
   * @returns 归一化评论 + 下一页游标
   */
  public async comments(mblogId: string, options?: TweetCommentsOptions): Promise<TweetCommentsPageResult> {
    return commentsPageFromRaw(await this.fetchRawComments(mblogId, options))
  }

  /**
   * 获取一条一级评论下的二级评论（归一化）。
   *
   * @returns 归一化评论 + 下一页游标
   */
  public async replies(_mblogId: string, rootCommentId: string, options?: TweetRepliesOptions): Promise<TweetCommentsPageResult> {
    return commentsPageFromRaw(await this.fetchRawReplies(_mblogId, rootCommentId, options))
  }

  /**
   * 获取长微博全文 `GET /ajax/statuses/longtext`
   *
   * @param mblogId 微博 id：mblogId / 数字 mid / 微博状态 URL（自动归一化）
   * @returns 含 `data.longTextContent` / `data.longTextContent_raw` 的响应（前者已是 HTML 片段）
   */
  public async fetchRawLongText(mblogId: string): Promise<LongtextResponse> {
    return await this.request(longtextSpec, { id: normalizeTweetIdInput(mblogId) })
  }

  /**
   * 获取长微博全文（归一化）。
   *
   * @param mblogId 微博 id：mblogId / 数字 mid / 微博状态 URL（自动归一化）
   * @returns `text` 优先取 `longTextContent_raw`，缺失时退回 `longTextContent`
   */
  public async longText(mblogId: string): Promise<TweetLongText> {
    return normalizeLongText(await this.fetchRawLongText(mblogId))
  }

  /**
   * 获取微博转发列表 `GET /ajax/statuses/repostTimeline`
   *
   * 分页用 `page`（实测 `next_cursor` 参数无效，两页返回相同数据）。
   *
   * @param mblogId 原微博 id：mblogId / 数字 mid / 微博状态 URL（自动归一化）
   * @param options 分页选项
   * @param options.page 页码（从 1 开始；缺省 = 第一页）
   * @param options.count 每页条数
   * @returns 校验后的转发响应；`data` 为转发微博数组，`total_number` 为总数
   */
  public async fetchRawReposts(mblogId: string, options?: TweetRepostsListOptions): Promise<RepostTimelineResponse> {
    const args: { id: string, page?: number, count?: number } = { id: normalizeTweetIdInput(mblogId) }
    if (options?.page !== undefined)
      args.page = options.page
    if (options?.count !== undefined)
      args.count = options.count
    return await this.request(repostTimelineSpec, args)
  }

  /**
   * 获取微博转发列表（归一化）。
   *
   * @param mblogId 原微博 id：mblogId / 数字 mid / 微博状态 URL（自动归一化）
   * @param options 分页选项
   * @returns 归一化转发微博 + 下一页判断
   */
  public async getReposts(mblogId: string, options?: TweetRepostsListOptions): Promise<TweetRepostsPageResult> {
    const raw = await this.fetchRawReposts(mblogId, options)
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
   * @param options.q 关键词（个人主页内搜索；缺省 = 不按关键词过滤）
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
  public async fetchRawSearchByDate(uid: string, options?: TweetSearchByDateOptions): Promise<SearchProfileResponse> {
    const args: SearchProfileArgs = { uid }
    if (options) {
      if (options.page !== undefined)
        args.page = options.page
      if (options.q !== undefined && options.q !== '')
        args.q = options.q
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
   * 按日期范围搜索用户微博（归一化）。
   *
   * @param uid 用户 UID
   * @param options 检索选项（全部可选）
   * @returns 归一化微博 + 上游报告总数 + 下一页判断
   */
  public async searchByDate(uid: string, options?: TweetSearchByDateOptions): Promise<TweetSearchByDatePageResult> {
    const raw = await this.fetchRawSearchByDate(uid, options)
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

  /**
   * 拉取首页「最新微博」关注时间线原始响应（低层数据源）
   *
   * `GET https://weibo.com/ajax/feed/friendstimeline`
   *
   * 分页语义（2026-10-20 OpenCLI 实测）：
   * - 首屏不传 `max_id`，或用 `since_id=0` + `refresh=4`（浏览器首屏写法）；
   * - 翻旧页传 `max_id=<上一页响应 max_id>`，响应 `max_id` 是下一页游标；
   * - `since_id` 只做增量过滤（返回比该微博 id 更新的条目），**不是**翻页游标；
   * - `count` 被上游忽略（固定 25）；`total_number` 为 2000 上限值。
   *
   * 缺省不发送 `list_id` / `fid`，返回默认首页时间线；指定关注分组时显式传入。
   *
   * @param options Feed 选项（全部可选）
   * @param options.list_id 关注分组 id（如「最新微博」= `11000` + 当前 uid）
   * @param options.fid 分组过滤参数（浏览器与 `list_id` 同时发送）
   * @param options.max_id 翻旧页游标（上一页 `max_id`；首屏省略）
   * @param options.since_id 增量过滤（只返回更新的微博；单页）
   * @param options.count 每页条数（上游实测忽略）
   * @param options.refresh 刷新标记（透传上游；实测不影响结果）
   * @returns 校验后的 friendstimeline 响应（`statuses` + `max_id` + `total_number`）
   */
  private async fetchRawFriendTimeline(options?: {
    list_id?: string | number
    fid?: string | number
    max_id?: string | number
    since_id?: string | number
    count?: number
    refresh?: number
  }): Promise<FriendstimelineResponse> {
    const args: FriendstimelineArgs = {}
    if (options?.list_id !== undefined)
      args.list_id = options.list_id
    if (options?.fid !== undefined)
      args.fid = options.fid
    if (options?.max_id !== undefined)
      args.max_id = options.max_id
    if (options?.since_id !== undefined)
      args.since_id = options.since_id
    if (options?.count !== undefined)
      args.count = options.count
    if (options?.refresh !== undefined)
      args.refresh = options.refresh
    return await this.request(friendstimelineSpec, args)
  }

  /**
   * 获取并归一化首页「最新微博」关注时间线（单页）
   *
   * 翻旧页用 `max_id`（响应 `maxId` 即下一页游标，缺省表示到底）；`since_id` 只做增量过滤。
   * `hasMore` 依据「本页非空 + 游标存在且前进」判断；不使用 `total_number`
   * （实测恒为 2000 上限值，不代表剩余条数）。
   *
   * @param options Feed 选项
   * @param options.maxId 翻旧页游标（上一页 `maxId`；首屏省略）
   * @param options.sinceId 增量过滤（只返回比该微博 id 更新的条目）
   * @param options.listId 关注分组 id（可选）
   * @param options.fid 分组过滤参数（可选）
   * @param options.count 每页条数（上游实测忽略）
   * @param options.refresh 刷新标记（透传上游）
   * @returns 归一化后的本页微博 + 下一页游标（`maxId`）
   */
  public async listFriendTimeline(options?: TweetFriendTimelineListOptions): Promise<TweetPageResult> {
    const traceId = `${Date.now()}-friendTimeline-${++normalizeSeq}`
    const raw = await this.fetchRawFriendTimeline({
      max_id: options?.maxId,
      since_id: options?.sinceId,
      list_id: options?.listId,
      fid: options?.fid,
      count: options?.count,
      refresh: options?.refresh,
    })
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
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'Tweet',
      count: tweets.length,
      duration_ms: Date.now() - startAt,
    })
    const result: TweetPageResult = { hasMore, tweets }
    if (nextMaxId !== undefined)
      result.maxId = nextMaxId
    if (raw.total_number !== undefined)
      result.total = raw.total_number
    return result
  }

  /**
   * 流式遍历首页「最新微博」关注时间线（`max_id` 游标 + 跨页 `mblogId` 去重）。
   *
   * - 默认从最新一条开始向旧翻页（`max_id` = 上一页 `maxId`）；
   * - 传 `sinceId` 时只请求一页，返回比该微博 id 更新的条目（增量）；
   * - `maxItems` 限制总条数；`since` / `until` 按日期早停 / 跳过；
   * - 停止条件：空页、整页重复、游标不前进、`maxPages`、范围边界。
   *
   * @example
   * for await (const tweet of sdk.tweets.streamFriendTimeline({ maxPages: 3 })) {
   *   console.log(tweet.mblogId, tweet.text)
   * }
   */
  async* streamFriendTimeline(options: TweetFriendTimelineStreamOptions = {}): AsyncIterableIterator<ITweet> {
    const range = createStreamRange<ITweet>(options, tweet => tweet.createdAt)

    if (options.sinceId !== undefined) {
      const page = await this.listFriendTimeline({
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
      const result = await this.listFriendTimeline({
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

  /**
   * 获取一页微博点赞者（D8）。
   *
   * 端点采用 `m.weibo.cn/api/attitudes/show`：网页端 `ajax/statuses/likeShow` 目前恒返回空数组
   * （见 `likersSpec` 注释）。**上游只接受数字 mid**（如 `tweet.id`），因此传入
   * mblogId / 微博 URL 时会自动用 `statuses/show` 解析一次数字 mid。
   *
   * @param mblogId 微博 id：数字 mid / mblogId / 微博状态 URL（自动解析为 mid）
   * @param options 分页选项
   * @returns 归一化点赞者 + 下一页页码
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async likers(mblogId: string, options: TweetLikersOptions = {}): Promise<TweetLikersPageResult> {
    const page = normalizeLikerPage(options.page)
    const startAt = Date.now()
    const id = await this.resolveTweetMid(mblogId)
    const raw = await this.request(likersSpec, { id, page })
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

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'TweetLiker',
      count: likers.length,
      duration_ms: Date.now() - startAt,
    })

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
   * 入参支持数字 mid / mblogId / 微博状态 URL；非数字形态会在开始时解析一次 mid。
   * 停止条件（任一命中）：空页（越界页 `data: null`）、整页重复、达到 `total_number`、`maxPages`。
   *
   * @example
   * for await (const liker of sdk.tweets.streamLikers('5355873276528697', { maxPages: 2 })) {
   *   console.log(liker.id, liker.name)
   * }
   */
  async* streamLikers(mblogId: string, options: TweetLikersStreamOptions = {}): AsyncIterableIterator<TweetLiker> {
    const normalized = normalizeTweetIdInput(mblogId)
    const id = await this.resolveTweetMid(normalized)
    const maxPages = normalizeLikerMaxPages(options.maxPages)
    const range = createStreamRange<TweetLiker>(options)
    const seen = new Set<string>()
    let page = normalizeLikerPage(options.page)
    let pages = 0
    let processed = 0
    let total: number | undefined

    while (pages < maxPages) {
      const result = await this.likers(id, { page })
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

  /**
   * 流式遍历一条微博的评论（`max_id` 游标 + 按评论 id 去重）。
   *
   * 入参支持 mblogId / 数字 mid / 微博状态 URL。只产出顶层评论；楼中楼仍在
   * `comment.replies` 中。停止条件（任一命中）：
   * 空页、整页重复、`max_id` 缺失 / 为 0 / 不前进、`maxPages`。
   *
   * 注意：上游 `total_number` 包含楼中楼（以及可能不可见的评论），不能作为停止条件；
   * hot 排序可能先返回空页（此时 `max_id` 仍非 0），按空页停止即可。
   *
   * @example
   * for await (const comment of sdk.tweets.streamComments('QqsYymYOS', { maxPages: 3 })) {
   *   console.log(comment.id, comment.text)
   * }
   */
  async* streamComments(mblogId: string, options: TweetCommentsStreamOptions = {}): AsyncIterableIterator<ITweetComment> {
    // flow=1 需要数字 mid；只解析一次，避免每页都多请求一次 statuses/show。
    const normalized = normalizeTweetIdInput(mblogId)
    const id = await this.resolveCommentsId(normalized, options)
    yield* this.streamCommentPages(
      normalized,
      options,
      cursor => this.fetchRawComments(id, {
        maxId: cursor,
        count: options.count,
        flow: options.flow,
        uid: options.uid,
      }),
    )
  }

  /**
   * 流式遍历一条一级评论下的二级评论（D13，`is_reply=1` + `fetch_level=1`，请求 `id=<一级评论 id>`）。
   *
   * 与 `streamComments` 共享分页 / 去重 / 停止语义；固定 `fetch_level: 1`。
   * `mblogId` 支持 mblogId / 数字 mid / 微博状态 URL；`rootCommentId` 必须是一级评论 id。
   *
   * @example
   * for await (const reply of sdk.tweets.streamReplies('QqsYymYOS', 'rootCommentId')) {
   *   console.log(reply.id, reply.text)
   * }
   */
  async* streamReplies(
    mblogId: string,
    rootCommentId: string,
    options: TweetCommentsStreamOptions = {},
  ): AsyncIterableIterator<ITweetComment> {
    const normalized = normalizeTweetIdInput(mblogId)
    yield* this.streamCommentPages(
      normalized,
      options,
      cursor => this.fetchRawReplies(normalized, rootCommentId, {
        maxId: cursor,
        count: options.count,
        flow: options.flow,
        uid: options.uid,
      }),
    )
  }

  private async* streamCommentPages(
    mblogId: string,
    options: TweetCommentsStreamOptions,
    fetchPage: (cursor?: number) => Promise<BuildCommentsResponse>,
  ): AsyncIterableIterator<ITweetComment> {
    const maxPages = normalizeMaxPages(options.maxPages)
    const range = createStreamRange<ITweetComment>(options)
    const seen = new Set<string>()
    let cursor = options.maxId
    let page = 1
    let pages = 0
    let processed = 0

    while (pages < maxPages) {
      const raw = await fetchPage(cursor)
      pages += 1

      const items = raw.data ?? []
      if (items.length === 0)
        break

      const fresh: ITweetComment[] = []
      for (const item of items) {
        const comment = normalizeComment(item)
        if (comment.id) {
          if (seen.has(comment.id))
            continue
          seen.add(comment.id)
        }
        fresh.push(comment)
      }
      if (fresh.length === 0)
        break

      for (const comment of fresh) {
        const decision = range.decide(comment)
        if (decision === 'stop')
          break
        if (decision === 'skip')
          continue
        processed += 1
        yield comment
      }

      try {
        await options.onProgress?.({
          mblogId,
          page,
          processed,
          pageSize: items.length,
          total: raw.total_number,
        })
      }
      catch {
        // 进度回调异常不影响流
      }

      if (range.stopped)
        break

      // 不能用 total_number 判断结束：顶层评论的 total 包含楼中楼 / 不可见评论。
      const next = typeof raw.max_id === 'number' && raw.max_id > 0 ? raw.max_id : undefined
      if (next === undefined || next === cursor)
        break
      cursor = next
      page += 1
    }
  }

  /**
   * 流式遍历一条微博的转发（page 游标 + 按转发微博 mblogId 去重）。
   *
   * 入参支持 mblogId / 数字 mid / 微博状态 URL。
   * 停止条件（任一命中）：空页、整页重复、达到 `total_number`、`maxPages`。
   *
   * @example
   * for await (const repost of sdk.tweets.streamReposts('QqsYymYOS', { maxPages: 2 })) {
   *   console.log(repost.mblogId, repost.user.name)
   * }
   */
  async* streamReposts(mblogId: string, options: TweetRepostsStreamOptions = {}): AsyncIterableIterator<ITweet> {
    const normalized = normalizeTweetIdInput(mblogId)
    const maxPages = normalizeMaxPages(options.maxPages)
    const range = createStreamRange<ITweet>(options, tweet => tweet.createdAt)
    const seen = new Set<string>()
    let page = options.page !== undefined ? Math.max(1, Math.floor(options.page)) : 1
    let pages = 0
    let processed = 0

    while (pages < maxPages) {
      const raw = await this.fetchRawReposts(normalized, { page, count: options.count })
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

      try {
        await options.onProgress?.({
          mblogId: normalized,
          page,
          processed,
          pageSize: items.length,
          total: raw.total_number,
        })
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
}
