import type { MyCommentsResponse } from '../endpoints/commentHistory'
import type { FavoritesResponse } from '../endpoints/favorite'
import type { LikeListResponse } from '../endpoints/like'
import type { ImageWallResponse, WaterfallResponse } from '../endpoints/media'
import type { BuildCommentsResponse, MyMblogResponse, RepostTimelineResponse, SearchProfileResponse } from '../endpoints/tweet'
import type { TweetCommentsOptions, TweetSearchByDateOptions } from './TweetService'
import type { ITweet, ITweetComment, TweetContractVersion } from '~/types/domain/ITweet'
import type { IUserMediaAsset } from '~/types/domain/IUserMediaAsset'
import type { WeiboSDKTelemetry } from '~/types/telemetry'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { advancePhase, createRunState, reconcileInitialPhase, resolveEnabledPhases } from '../archive/checkpoint'
import { streamCommentHistory } from '../archive/phases/comments'
import { streamFavorites } from '../archive/phases/favorites'
import { streamLikes } from '../archive/phases/likes'
import { streamImages, streamVideos } from '../archive/phases/media'
import { streamTimeline } from '../archive/phases/timeline'
import { ArchiveRuntime } from '../archive/runtime'

/**
 * 归档进度类型。
 *
 * `timeline`（用户微博 + 内联转发；mymblog 翻到底后可继续用 searchProfile 日期切片）
 * → `likes`（我赞过的微博，page）→ `comments`（当前用户历史评论，max_id）
 * → `favorites`（收藏，page）→ `done`
 */
export type ArchivePhase = 'timeline' | 'likes' | 'comments' | 'favorites' | 'images' | 'videos' | 'done'

/**
 * timeline 阶段的数据源（P1-5）。
 *
 * - `mymblog`：先翻 mymblog page 游标；翻到底后按需继续日期切片（默认）。
 * - `search`：跳过 mymblog，直接从日期切片开始（适合明确只走 searchProfile 的场景）。
 */
export type ArchiveTimelineSource = 'mymblog' | 'search'

/** P1-4：单条/分页失败后的动作。 */
export type ArchiveErrorAction = 'abort' | 'skip' | 'retry'

/** P1-4：失败发生的阶段。 */
export type ArchiveErrorStage = 'comments' | 'commentHistory' | 'likes' | 'reposts' | 'timeline' | 'favorites' | 'images' | 'videos'

/** P1-4：`onItemError` 回调上下文。 */
export interface ArchiveItemErrorContext {
  /** 归档所属用户 UID */
  uid: string
  /** 出错时归档所处阶段（timeline / favorites / done） */
  phase: ArchivePhase
  /** 出错的具体环节（comments / reposts / timeline / favorites） */
  stage: ArchiveErrorStage
  /** 出错的条目来源（timeline / repost / favorite） */
  source: ArchiveItem['source']
  /** 出错条目自身的 mblogId（分页失败时缺省） */
  mblogId?: string
  /** 转发阶段：转发所属原微博 mblogId */
  parentMblogId?: string
  /** 出错时正在处理的页码 */
  page?: number
}

/** P1-3：归档进度（每页/每阶段触发一次）。 */
export interface ArchiveProgress {
  /** 归档所属用户 UID */
  uid: string
  /** 当前阶段（timeline / favorites / done） */
  phase: ArchivePhase
  /** 本次归档已产出条目数（含转发的子项） */
  processed: number
  /** 上游给出的总量（不可用时省略） */
  total?: number
  /** 预估剩余条数（不可用时省略） */
  remaining?: number
  /** 当前进度数据源：mymblog / search / likes / comments / favorites / images / videos / done */
  source?: 'mymblog' | 'search' | 'likes' | 'comments' | 'favorites' | 'images' | 'videos' | 'done'
  /** 当前页码（mymblog / searchProfile / favorites） */
  page?: number
}

/**
 * 归档进度 checkpoint（A6 断点续传；P1-1/P1-2 后大小恒定）。
 *
 * 保存最后一个 `ArchiveItem.checkpoint`，中断后传入 `streamArchive` 的 `options.checkpoint` 即可续跑。
 *
 * - `page`：mymblog **当前页**（恢复时重跑该页）；`lastTimelineMblogId` 用于跳过页内已处理项。
 * - `lastTimelineMblogId`：已完整处理（含其转发）的最后一条微博。
 * - `sliceEnd` / `slicePage` / `sliceWindow`：P1-5 日期切片游标（unix 秒）。
 *   `sliceEnd` 存在即表示当前处于日期切片阶段，恢复时跳过 mymblog。
 */
export interface ArchiveCheckpoint {
  uid: string
  phase: ArchivePhase
  /** mymblog 阶段当前页（恢复时从该页重跑） */
  page?: number
  /** 已完整处理（含其转发）的最后一条微博 mblogId（mymblog / 日期切片页内共用） */
  lastTimelineMblogId?: string
  /** favorites 阶段：当前页 */
  favoritesPage?: number
  /** likes 阶段：当前页（恢复时重跑该页） */
  likesPage?: number
  /**
   * images 阶段：下一页图片墙游标（上游 `since_id`）。
   *
   * 恢复时从该游标继续；缺省表示从第一页开始。
   */
  imagesCursor?: string
  /**
   * videos 阶段：下一页视频瀑布游标（上游 `next_cursor`）。
   *
   * 恢复时从该游标继续；缺省表示从第一页开始。
   */
  videosCursor?: string
  /**
   * comments 阶段：当前页使用的游标（上游 `max_id`）。
   *
   * 恢复时重跑该页（重复但不会漏）；缺省表示从第一页开始。
   */
  commentHistoryCursor?: number
  /** P1-5 日期切片：当前切片包含的结束时间（unix 秒，含） */
  sliceEnd?: number
  /** P1-5 日期切片：当前 searchProfile 页码 */
  slicePage?: number
  /** P1-5 日期切片：自适应窗口大小（秒） */
  sliceWindow?: number
}

/**
 * 归档流产出项（磁盘条目信封，K1 / P0-1）。
 *
 * `schemaVersion` 为 ITweet 存档契约版本（与包版本解耦），落盘条目据此自描述、
 * 下游可按版本迁移（规则与迁移策略见 website/reference/tweet-contract.md）；
 * `tweet` 为归一化模型；`schemaDigest` 为 raw 项的结构快照（A7，`stripVolatileKeys`），
 * 用于检测上游字段漂移（同一源同一时期 digest 应稳定）——注意与契约版本用途不同。
 */
export interface ArchiveItem {
  schemaVersion: TweetContractVersion
  source: 'timeline' | 'repost' | 'favorite' | 'like' | 'comment' | 'image' | 'video'
  /**
   * 微博字母 id。
   *
   * `source: 'image'` 时可能缺省（图片墙条目不一定带 `mblogid`），此时可取 `asset.id`。
   */
  mblogId?: string
  /**
   * 归一化微博。
   *
   * `source: 'image'` 时缺省（图片墙条目不是完整微博）；其余来源恒有。
   */
  tweet?: ITweet
  /** `source: 'image' | 'video'` 时为对应的媒体资产 */
  asset?: IUserMediaAsset
  schemaDigest: unknown
  checkpoint: ArchiveCheckpoint
  /** `source: 'comment'` 时为对应的历史评论（评论通知项本身不是微博） */
  comment?: ITweetComment
}

/**
 * 归档级 raw 回调元数据（P1-9）。
 */
export interface ArchiveRawMeta {
  uid: string
  source: ArchiveItem['source']
  mblogId: string
  /** 当前阶段页码（timeline / reposts / favorites；日期切片时为 searchProfile 页码） */
  page?: number
  /** repost 阶段：转发所属原微博 mblogId */
  parentMblogId?: string
}

/**
 * ArchiveService 依赖（注入子 Service，便于离线 mock）。
 * 通过轻量接口隔离，ArchiveService 只编排不直接发请求。
 */
export interface ArchiveServiceDeps {
  tweets: {
    fetchRawUserTimelinePage: (uid: string, page?: number, count?: number) => Promise<MyMblogResponse>
    fetchRawReposts: (mblogId: string, options?: { page?: number }) => Promise<RepostTimelineResponse>
    /**
     * P1-5 日期切片数据源。`starttime` / `endtime` 为 unix 秒。
     * 未提供时：显式 `timelineSource: 'search'` 会抛 `InvalidConfigError`；
     * 默认 `mymblog` 模式则只跳过切片回填。
     */
    fetchRawSearchByDate?: (uid: string, options?: TweetSearchByDateOptions) => Promise<SearchProfileResponse>
    /**
     * P1-6 评论数据源。未提供时 `includeComments: true` 会抛 `InvalidConfigError`。
     */
    fetchRawComments?: (mblogId: string, options?: TweetCommentsOptions) => Promise<BuildCommentsResponse>
  }
  favorites: {
    fetchRawFavorites: (uid: string, page?: number) => Promise<FavoritesResponse>
  }
  /**
   * D1 点赞数据源。未提供时 `includeLikes: true` 会抛 `InvalidConfigError`。
   *
   * `fetchRawPage` 返回 schema 校验后的原始页（保留 raw 以生成 `schemaDigest`）。
   */
  likes?: {
    fetchRawPage: (uid: string, page?: number) => Promise<LikeListResponse>
  }
  /**
   * D2 历史评论数据源。未提供时 `includeCommentHistory: true` 会抛 `InvalidConfigError`。
   */
  commentHistory?: {
    fetchRawPage: (options: { maxId?: number, page?: number }) => Promise<MyCommentsResponse>
  }
  /**
   * D4 / D5 媒体集合数据源。提供原始页（保留 raw 以生成 `schemaDigest`）。
   *
   * 未提供时 `includeImages: true` / `includeVideos: true` 会在首次迭代抛 `InvalidConfigError`。
   */
  media?: {
    fetchRawImagePage: (uid: string, options?: { sinceId?: string | number }) => Promise<ImageWallResponse>
    fetchRawVideoPage: (uid: string, options?: { cursor?: string | number }) => Promise<WaterfallResponse>
  }
  /**
   * 解析当前登录账号 uid（账号级数据源守卫）。
   *
   * 收藏（`all_fav` 忽略 uid）与历史评论（`myCmt` 无 uid）只能读取登录账号自身；
   * 未提供时不校验跨账号（自定义 deps 场景），默认 SDK 会注入。
   */
  sessionUid?: () => Promise<string | undefined>
  /**
   * 当前 SDK 的鉴权模式（默认 `cookie`）。
   *
   * guest 模式不承诺完整时间线（m 站匿名只有第一页），因此归档直接拒绝，
   * 避免把「第一页采样」当成完整归档。
   */
  authMode?: 'cookie' | 'guest'
  /** P1-3：归档进度 Wide Event（可选；失败不影响归档）。 */
  telemetry?: WeiboSDKTelemetry
}

/**
 * 增量归档选项。
 *
 * 仅作用于 timeline（mymblog / 日期切片）；点赞、收藏、媒体等阶段仍按各自分页完整遍历。
 */
export interface ArchiveIncrementalOptions {
  /**
   * 时间下界（unix 秒，或 `YYYY-MM-DD` / `YYYYMMDD`）。
   *
   * timeline 遇到更旧（且非置顶）的微博即停止；置顶微博不参与时间边界判断。
   */
  since?: number | string
  /** 遇到该 mblogId 即停止（不产出该条），用于「翻到上次同步位置」早停。 */
  stopAtMblogId?: string
  /** 是否跳过置顶微博（默认 false：照常产出，但不作为时间边界）。 */
  skipPinned?: boolean
}

/**
 * `streamArchive` 的选项总表（全部可选；仅 `checkpoint` / `onRaw` / `onProgress` 影响调用方契约）。
 *
 * 只复制已知字段的 checkpoint 语义见 `ArchiveCheckpoint`；依赖缺失（如
 * `timelineSource: 'search'` 但未注入 `fetchRawSearchByDate`）会在**首次迭代时**抛 `InvalidConfigError`。
 */
export interface ArchiveStreamOptions {
  /** 是否归档每条微博的转发（默认 true） */
  includeReposts?: boolean
  /** 是否归档收藏（默认 true） */
  includeFavorites?: boolean
  /**
   * D1：是否归档「我赞过的微博」（默认 false）。
   *
   * 需要注入 `deps.likes`；`ArchiveItem.source = 'like'`。
   */
  includeLikes?: boolean
  /**
   * D2：是否归档当前登录用户的历史评论（默认 false）。
   *
   * 需要注入 `deps.commentHistory`；`ArchiveItem.source = 'comment'`，
   * 评论本体在 `item.comment`，`item.tweet` 为被评论微博。
   */
  includeCommentHistory?: boolean
  /**
   * D4：是否归档用户图片墙（默认 false）。
   *
   * 需要注入 `deps.media.fetchRawImagePage`；`ArchiveItem.source = 'image'`，
   * 媒体资产在 `item.asset`（图片墙条目不包含完整微博，`item.tweet` 缺省）。
   */
  includeImages?: boolean
  /**
   * D5：是否归档用户视频瀑布（默认 false）。
   *
   * 需要注入 `deps.media.fetchRawVideoPage`；`ArchiveItem.source = 'video'`，
   * 同时带 `item.tweet` 与 `item.asset`。
   */
  includeVideos?: boolean
  /** 每页条数（timeline 阶段，默认 20） */
  count?: number
  /** 每阶段最多翻页数（测试/演示限制，默认不限） */
  maxPagesPerPhase?: number
  /**
   * 页内并发预取窗口（默认 3，范围 1–8）。
   *
   * 只并发同一页内条目之间互不依赖的子请求（评论链、转发首页），
   * 产出顺序、`onRaw` 顺序与 checkpoint 语义不变；分页本身仍严格串行。
   * 实际 HTTP 并发仍受 `RateLimitService` 令牌桶与 432 全局暂停约束，
   * 设为 `1` 可回到完全串行。
   */
  concurrency?: number
  /** 断点续传：传入上次保存的 checkpoint */
  checkpoint?: ArchiveCheckpoint
  /**
   * 归档级 raw 回调（P1-9）：每个原始微博项在归一化前触发。
   *
   * `raw` 为上游原始 JSON（未校验），下游自行落盘；`ArchiveItem` 不携带 raw。
   */
  onRaw?: (raw: unknown, meta: ArchiveRawMeta) => void | Promise<void>
  /**
   * timeline 数据源（P1-5）。
   *
   * - `mymblog`（默认）：page 游标翻到底后，按需用 searchProfile 日期切片补齐更早内容。
   * - `search`：跳过 mymblog，直接日期切片。
   */
  timelineSource?: ArchiveTimelineSource
  /**
   * mymblog 翻到底后是否用 searchProfile 日期切片补齐（默认 true）。
   * `timelineSource: 'search'` 时忽略本项。
   */
  includeDateSlices?: boolean
  /** 日期切片下界（unix 秒，含；默认微博上线日 2009-08-14） */
  since?: number
  /** 日期切片上界（unix 秒，含；默认当前时间） */
  until?: number
  /** 日期切片的关键词过滤（D12；先按日期窗口，再按 `q` 搜索） */
  searchQuery?: string
  /** 自适应切片初始窗口大小（秒，默认 30 天） */
  sliceWindow?: number
  /** 单个切片最多条数；超过则对半缩小窗口（默认 800，留出分页安全余量） */
  maxSliceItems?: number
  /**
   * P1-6：是否拉取并挂载评论到 `tweet.comments`（默认 false）。
   * 评论只挂到 timeline / repost 项，favorite 项不拉取。
   */
  includeComments?: boolean
  /** P1-6：每条微博最多拉取评论页数（默认不限；`--comment-pages` 可限制）。 */
  maxCommentPagesPerTweet?: number
  /** P1-6：评论每页条数（默认 20）。 */
  commentCount?: number
  /** P1-3：归档进度回调（每页/每阶段一次；异常不会中断归档）。 */
  onProgress?: (progress: ArchiveProgress) => void | Promise<void>
  /**
   * P1-4：单条/分页失败回调。返回 `abort` / `skip` / `retry`；
   * 未返回时使用对应阶段的默认策略（reposts/comments 默认 `skip`，timeline/favorites 默认 `abort`）。
   */
  onItemError?: (error: unknown, context: ArchiveItemErrorContext) => ArchiveErrorAction | void | Promise<ArchiveErrorAction | void>
  /** P1-4：转发页失败策略（默认 `skip`，不中止整条归档）。 */
  repostErrorPolicy?: ArchiveErrorAction
  /** P1-4：评论拉取失败策略（默认 `skip`，不影响微博本体）。 */
  commentsErrorPolicy?: ArchiveErrorAction
  /** P1-4：点赞页失败策略（默认 `abort`）。 */
  likesErrorPolicy?: ArchiveErrorAction
  /** P1-4：历史评论页失败策略（默认 `abort`）。 */
  commentHistoryErrorPolicy?: ArchiveErrorAction
  /** P1-4：图片墙页失败策略（默认 `abort`）。 */
  imagesErrorPolicy?: ArchiveErrorAction
  /** P1-4：视频瀑布页失败策略（默认 `abort`）。 */
  videosErrorPolicy?: ArchiveErrorAction
  /**
   * 增量模式（仅 timeline）：时间下界 / 已见 mblogId 早停 / 置顶策略。
   *
   * 与断点续传 checkpoint 独立：checkpoint 负责「从哪里继续」，incremental 负责「到哪里停止」。
   */
  incremental?: ArchiveIncrementalOptions
  /** 仅归档原创微博（无 `retweeted_status`）；同时跳过内联转发（默认 false）。 */
  originalOnly?: boolean
  /** P1-4：可重试错误的最大重试次数（默认 1）。 */
  maxRetries?: number
  /** P1-4：重试间隔毫秒（默认 0）。 */
  retryDelayMs?: number
}

/** 多账号归档的产出项。 */
export interface ArchiveUserItem {
  /** 当前归档用户 UID */
  uid: string
  /** 该用户的归档条目 */
  item: ArchiveItem
}

/** `streamUsersArchive` 的选项：在单账号选项上增加按用户的 checkpoint / 生命周期回调。 */
export interface ArchiveUsersOptions extends Omit<ArchiveStreamOptions, 'checkpoint'> {
  /** 按 uid 读取断点续传 checkpoint */
  getCheckpoint?: (uid: string) => ArchiveCheckpoint | undefined
  /** 按 uid 读取增量选项（优先于共享的 `incremental`） */
  getIncremental?: (uid: string) => ArchiveIncrementalOptions | undefined
  /** 开始归档某个用户（在拉取第一页前触发） */
  onUserStart?: (uid: string) => void | Promise<void>
  /** 某个用户归档完成 */
  onUserDone?: (uid: string, count: number) => void | Promise<void>
  /**
   * 单个用户失败时的策略（默认 `abort`）。
   *
   * 返回 `skip` 继续下一个用户；`abort` 抛错终止整批；`retry` 仅对可重试错误重试。
   */
  onUserError?: (uid: string, error: unknown) => ArchiveErrorAction | void | Promise<ArchiveErrorAction | void>
}

/**
 * 单账号归档流（A5）：把 timeline（内联转发）+ favorites 串成一条可恢复的 AsyncIterator。
 *
 * P1-5：mymblog 的 page 游标有上限。翻到底后，如果 `data.total` 表明仍有剩余
 * （或 total 不可用），从当前最旧一条微博继续用 `searchProfile` 做日期切片，
 * 每片内部再按 page 翻页；单片 `total` 过大时对半缩小窗口，直到安全分页。
 *
 * 用法（≤20 行镜像单账号）：
 * ```ts
 * for await (const item of sdk.archive.streamArchive(uid)) {
 *   await persist(item.tweet)        // 落盘
 *   lastCheckpoint = item.checkpoint // 保存进度，中断后可续传
 * }
 * ```
 */
export class ArchiveService {
  private sessionUidPromise?: Promise<string | undefined>

  /**
   * @param deps 注入的子服务（`tweets` / `favorites` / `telemetry`）；ArchiveService 只编排、不直接发请求，
   * 因此可用轻量 mock 做离线测试
   */
  constructor(private deps: ArchiveServiceDeps) {}

  /**
   * 单账号归档流：逐条产出 `ArchiveItem`（timeline → 内联转发 → 可选评论 → favorites → done）。
   *
   * 语义要点：
   * - 每个 item 自带 `checkpoint`（浅拷贝快照），中断后把最后一个传给 `options.checkpoint` 即可续跑；
   *   恢复时可能重跑当前页/当前项（重复但不会漏，下游需按 `mblogId` 去重）。
   * - `options.onRaw` 在归一化**之前**逐原始项触发，供下游自行落盘 raw（`ArchiveItem` 不携带 raw）。
   * - `options.onRaw` / `onProgress` / `onItemError` 抛错不会中断归档；`onProgress` 同时发
   *   `archive_progress` Wide Event，单条失败发 `archive_item_error`。
   * - 失败策略：`abort` 抛出、`skip` 跳过继续、`retry` 仅对 `retryable` 结构化错误重试
   *   （最多 `maxRetries` 次，间隔 `retryDelayMs`）；未指定时沿用阶段默认（reposts/comments 为 `skip`，
   *   timeline/favorites 为 `abort`）。
   *
   * 阶段实现见 `services/archive/phases/*`；运行期状态与 checkpoint 收敛见
   * `services/archive/runtime.ts` / `services/archive/checkpoint.ts`。
   *
   * @param uid 归档用户 UID
   * @param options 归档选项，见 `ArchiveStreamOptions`
   * @throws `InvalidConfigError` 选项与注入依赖不匹配（`timelineSource: 'search'` 缺 `fetchRawSearchByDate`、
   * `includeComments: true` 缺 `fetchRawComments`），在首次迭代时抛出
   * @throws 原始错误（当错误策略为 `abort`，或 `retry` 已达上限且阶段默认为 `abort`）
   */
  async* streamArchive(uid: string, options: ArchiveStreamOptions = {}): AsyncIterableIterator<ArchiveItem> {
    if (this.deps.authMode === 'guest') {
      throw new InvalidConfigError(
        'Guest mode cannot run a full archive: anonymous m.weibo.cn lists are first-page only. '
        + 'Provide a signed-in cookie for archive, or use detail / comments / media reads individually.',
        {
          field: 'archive',
          authMode: 'guest',
          uid,
          hint: '访客模式只支持公开数据采样，不承诺完整时间线',
          next: '配置登录 Cookie 后重试；或改用 sdk.tweets / sdk.media 等单点能力',
        },
      )
    }

    // 选项归一化与依赖校验在 runtime 构造期完成（顺序与历史行为一致）；
    // 阶段函数只依赖 runtime，不再共享 streamArchive 的闭包。
    const state = createRunState(options.checkpoint)
    const runtime = new ArchiveRuntime(uid, this.deps, options, state)

    await this.assertAccountLevelSources([uid], {
      includeFavorites: runtime.includeFavorites,
      includeCommentHistory: runtime.includeCommentHistory,
    })

    const enabledPhases = resolveEnabledPhases({
      includeLikes: runtime.includeLikes,
      includeCommentHistory: runtime.includeCommentHistory,
      includeFavorites: runtime.includeFavorites,
      includeImages: runtime.includeImages,
      includeVideos: runtime.includeVideos,
    })

    // checkpoint 停在未启用阶段时跳到下一个启用阶段（例如上次启用了 likes、本次关闭）。
    reconcileInitialPhase(state, enabledPhases)
    runtime.commit()

    if (state.phase === 'timeline')
      yield* streamTimeline(runtime)
    if (state.phase === 'timeline') {
      advancePhase(state, enabledPhases)
      runtime.commit()
    }

    if (state.phase === 'likes')
      yield* streamLikes(runtime)
    if (state.phase === 'likes') {
      advancePhase(state, enabledPhases)
      runtime.commit()
    }

    if (state.phase === 'comments')
      yield* streamCommentHistory(runtime)
    if (state.phase === 'comments') {
      advancePhase(state, enabledPhases)
      runtime.commit()
    }

    if (state.phase === 'favorites')
      yield* streamFavorites(runtime)
    if (state.phase === 'favorites') {
      advancePhase(state, enabledPhases)
      runtime.commit()
    }

    if (state.phase === 'images')
      yield* streamImages(runtime)
    if (state.phase === 'images') {
      advancePhase(state, enabledPhases)
      runtime.commit()
    }

    if (state.phase === 'videos')
      yield* streamVideos(runtime)
    if (state.phase === 'videos') {
      advancePhase(state, enabledPhases)
      runtime.commit()
    }

    if (runtime.cp.phase === 'done')
      await runtime.reportProgress({ source: 'done' })
  }

  /**
   * 多账号批量归档：按 uid 顺序串行执行 `streamArchive`，逐个产出 `{ uid, item }`。
   *
   * 每个用户独立 checkpoint（通过 `getCheckpoint(uid)` 读取）；单用户失败默认终止整批，
   * 可用 `onUserError` 返回 `'skip'` 跳过该用户、或对可重试错误返回 `'retry'`。
   *
   * @example
   * for await (const { uid, item } of sdk.archive.streamUsersArchive(['111', '222'], {
   *   includeLikes: true,
   *   getCheckpoint: uid => loadCheckpoint(uid),
   * })) {
   *   await persist(uid, item)
   * }
   */
  async* streamUsersArchive(uids: string[], options: ArchiveUsersOptions = {}): AsyncIterableIterator<ArchiveUserItem> {
    const {
      getCheckpoint,
      getIncremental,
      onUserStart,
      onUserDone,
      onUserError,
      ...streamOptions
    } = options
    const maxRetries = streamOptions.maxRetries ?? 1
    const targets = uids.filter(value => typeof value === 'string' && value.trim() !== '')

    if (this.deps.authMode === 'guest') {
      throw new InvalidConfigError(
        'Guest mode cannot run a full archive: anonymous m.weibo.cn lists are first-page only.',
        { field: 'archive', authMode: 'guest', uids: targets },
      )
    }

    // 账号级数据源只能读登录账号自身；批量跨账号时在产出任何 item 前失败。
    await this.assertAccountLevelSources(targets, {
      includeFavorites: streamOptions.includeFavorites ?? true,
      includeCommentHistory: streamOptions.includeCommentHistory ?? false,
    })

    for (const uid of targets) {
      let attempt = 0

      while (true) {
        try {
          await onUserStart?.(uid)
          let count = 0
          for await (const item of this.streamArchive(uid, {
            ...streamOptions,
            ...(getIncremental?.(uid) === undefined ? {} : { incremental: getIncremental(uid) }),
            checkpoint: getCheckpoint?.(uid),
          })) {
            count += 1
            yield { uid, item }
          }
          await onUserDone?.(uid, count)
          break
        }
        catch (error) {
          const action = (await onUserError?.(uid, error)) ?? 'abort'
          const retryable = error instanceof WeiboSDKError ? error.retryable : false
          if (action === 'retry' && retryable && attempt < maxRetries) {
            attempt += 1
            continue
          }
          if (action === 'skip')
            break
          throw error
        }
      }
    }
  }

  /**
   * 账号级数据源守卫。
   *
   * `includeFavorites`（`/ajax/favorites/all_fav` 忽略 uid）与 `includeCommentHistory`
   * （`/ajax/message/myCmt` 没有 uid）只能读取登录账号自身。跨账号归档时静默拼接会把
   * 登录账号的数据写进目标账号的归档，因此在首次迭代前直接报错。
   *
   * `sessionUid` 未注入或无法解析时不做校验（自定义 deps / 未知会话）。
   */
  private async assertAccountLevelSources(
    uids: string[],
    flags: { includeFavorites: boolean, includeCommentHistory: boolean },
  ): Promise<void> {
    if (!flags.includeFavorites && !flags.includeCommentHistory)
      return
    if (uids.length === 0)
      return

    const sessionUid = await this.resolveSessionUid()
    if (sessionUid === undefined)
      return

    const foreignUid = uids.find(uid => uid !== sessionUid)
    if (foreignUid === undefined)
      return

    throw new InvalidConfigError(
      `Archive account-level sources (includeFavorites / includeCommentHistory) read the signed-in account only `
      + `(uid ${sessionUid}); refusing to archive uid ${foreignUid}. Disable these options or archive the signed-in account.`,
      {
        uid: foreignUid,
        sessionUid,
        includeFavorites: flags.includeFavorites,
        includeCommentHistory: flags.includeCommentHistory,
      },
    )
  }

  /** 登录 uid 只解析一次（批量归档时避免每个 uid 都请求 `profile/detail`）。 */
  private async resolveSessionUid(): Promise<string | undefined> {
    if (!this.deps.sessionUid)
      return undefined
    this.sessionUidPromise ??= this.deps.sessionUid()
    return await this.sessionUidPromise
  }
}
