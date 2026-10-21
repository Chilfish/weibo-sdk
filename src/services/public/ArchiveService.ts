import type { MyCommentsResponse } from '../endpoints/commentHistory'
import type { FavoritesResponse } from '../endpoints/favorite'
import type { LikeListResponse } from '../endpoints/like'
import type { ImageWallResponse, WaterfallResponse } from '../endpoints/media'
import type { BuildCommentsResponse, MyMblogResponse, RepostTimelineResponse, SearchProfileResponse } from '../endpoints/tweet'
import type { ITweetComment, TweetContractVersion } from '~/types/domain/ITweet'
import type { IUserMediaAsset } from '~/types/domain/IUserMediaAsset'
import type { WeiboSDKTelemetry } from '~/types/telemetry'
import { normalizeImageWallItem, normalizeWaterfallVideo } from '~/models/data/Media'
import { normalizeComment, Tweet } from '~/models/data/Tweet'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { TWEET_CONTRACT_VERSION } from '~/types/domain/ITweet'
import { stripVolatileKeys } from '~/utils/structure'
import { resolveTimeInput } from '~/utils/timeInput'

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
 * 下游可按版本迁移（规则与迁移策略见 docs/engineering/contract-itweet-v2.md）；
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
  tweet?: Tweet
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
    getReposts: (mblogId: string, options?: { page?: number }) => Promise<RepostTimelineResponse>
    /**
     * P1-5 日期切片数据源。`starttime` / `endtime` 为 unix 秒。
     * 未提供时：显式 `timelineSource: 'search'` 会抛 `InvalidConfigError`；
     * 默认 `mymblog` 模式则只跳过切片回填。
     */
    searchByDate?: (uid: string, options?: {
      page?: number
      starttime?: number | string
      endtime?: number | string
    }) => Promise<SearchProfileResponse>
    /**
     * P1-6 评论数据源。未提供时 `includeComments: true` 会抛 `InvalidConfigError`。
     */
    comments?: (mblogId: string, options?: {
      max_id?: number
      count?: number
      flow?: 0 | 1
      uid?: string
    }) => Promise<BuildCommentsResponse>
  }
  favorites: {
    getFavorites: (uid: string, page?: number) => Promise<FavoritesResponse>
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
 * `timelineSource: 'search'` 但未注入 `searchByDate`）会在**首次迭代时**抛 `InvalidConfigError`。
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

/** 微博上线日（unix 秒）；日期切片默认下界。 */
const WEIBO_EPOCH_SECONDS = Math.floor(Date.UTC(2009, 7, 14) / 1000)
const DEFAULT_SLICE_WINDOW = 30 * 24 * 60 * 60
const MIN_SLICE_WINDOW = 60
const MAX_SLICE_WINDOW = 5 * 365 * 24 * 60 * 60
const DEFAULT_MAX_SLICE_ITEMS = 800
const DEFAULT_ARCHIVE_CONCURRENCY = 3
const MAX_ARCHIVE_CONCURRENCY = 8

type TimelineRawItem = MyMblogResponse['data']['list'][number]

/** 页内并发窗口：非有限值回退默认，其余夹到 `[1, 8]`。 */
function resolveConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return DEFAULT_ARCHIVE_CONCURRENCY
  return Math.min(MAX_ARCHIVE_CONCURRENCY, Math.max(1, Math.floor(value)))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryableError(error: unknown): boolean {
  return error instanceof WeiboSDKError ? error.retryable : false
}

function toErrorTelemetryFields(error: unknown): {
  error_name: string
  error_message?: string
  error_code?: string
  error_level?: WeiboSDKError['level']
  error_retryable?: boolean
} {
  if (error instanceof WeiboSDKError) {
    return {
      error_name: error.name,
      error_message: error.message,
      error_code: error.code,
      error_level: error.level,
      error_retryable: error.retryable,
    }
  }
  if (error instanceof Error)
    return { error_name: error.name, error_message: error.message }
  return { error_name: typeof error }
}

/** 单页内按 mblogid 去重（保持上游顺序）。 */
function uniqueByMblogId<T extends { mblogid: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of list) {
    if (seen.has(item.mblogid))
      continue
    seen.add(item.mblogid)
    out.push(item)
  }
  return out
}

/**
 * 整页重复保护：所有 id 都出现在上一页 → 上游忽略了 page/游标，视为到底。
 * 避免上游重复返回同一页时无限翻页。
 */
function isRepeatedPage(ids: string[], previousPageIds: Set<string>): boolean {
  return ids.length > 0 && ids.every(id => previousPageIds.has(id))
}

/** 解析上游 `created_at`（如 `Mon Oct 19 13:56:50 +0800 2026`）为 unix 秒。 */
function parseCreatedAt(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === '')
    return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

/** `searchProfile.data.total` 实测为 number | string；统一解析为数字。 */
function parseTotal(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** 游标解析：`next_cursor` 实测为 number | string；非法值按 `0`（到底）处理。 */
function parseCursor(value: unknown): number {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/** 游标字符串归一化：空 / `0` / `-1` 视为缺省（第一页）。 */
function normalizeCursorString(value: unknown): string | undefined {
  if (value === undefined || value === null)
    return undefined
  const text = String(value).trim()
  if (text === '' || text === '0' || text === '-1')
    return undefined
  return text
}

/** 置顶微博判定（上游字段不稳定；只认明确的布尔 / 数字标记）。 */
function isPinnedRaw(raw: { isTop?: unknown, top?: unknown }): boolean {
  return raw.isTop === true || raw.isTop === 1 || raw.top === true || raw.top === 1
}

/** 原创微博判定：没有 `retweeted_status`。 */
function isOriginalRaw(raw: { retweeted_status?: unknown }): boolean {
  return raw.retweeted_status === undefined || raw.retweeted_status === null
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
   * @param uid 归档用户 UID
   * @param options 归档选项，见 `ArchiveStreamOptions`
   * @throws `InvalidConfigError` 选项与注入依赖不匹配（`timelineSource: 'search'` 缺 `searchByDate`、
   * `includeComments: true` 缺 `comments`），在首次迭代时抛出
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

    const originalOnly = options.originalOnly ?? false
    const includeReposts = (options.includeReposts ?? true) && !originalOnly
    const includeFavorites = options.includeFavorites ?? true
    const includeLikes = options.includeLikes ?? false
    const includeCommentHistory = options.includeCommentHistory ?? false
    const includeImages = options.includeImages ?? false
    const includeVideos = options.includeVideos ?? false
    const maxPages = options.maxPagesPerPhase ?? Number.POSITIVE_INFINITY
    const count = options.count ?? 20
    const concurrency = resolveConcurrency(options.concurrency)
    const timelineSource = options.timelineSource ?? 'mymblog'
    const includeDateSlices = options.includeDateSlices ?? true
    const since = options.since ?? WEIBO_EPOCH_SECONDS
    const maxSliceItems = options.maxSliceItems ?? DEFAULT_MAX_SLICE_ITEMS
    const incrementalSince = options.incremental?.since === undefined
      ? undefined
      : resolveTimeInput(options.incremental.since, { boundary: 'start', field: 'incremental.since' })
    const stopAtMblogId = options.incremental?.stopAtMblogId
    const skipPinned = options.incremental?.skipPinned ?? false
    // 解构方法会丢失 this：显式绑定到 tweets 实例。
    const searchByDate = this.deps.tweets.searchByDate?.bind(this.deps.tweets)

    if (timelineSource === 'search' && !searchByDate) {
      throw new InvalidConfigError('ArchiveService timelineSource="search" requires deps.tweets.searchByDate.', {
        field: 'tweets.searchByDate',
      })
    }

    // 只复制已知字段：旧 checkpoint 可能含 visitedMblogIds 等历史字段，避免它们回流。
    const input = options.checkpoint
    let phase: ArchivePhase = input?.phase ?? 'timeline'
    let page = input?.page
    let lastTimelineMblogId = input?.lastTimelineMblogId
    let favoritesPage = input?.favoritesPage
    let likesPage = input?.likesPage
    let imagesCursor = input?.imagesCursor
    let videosCursor = input?.videosCursor
    const commentHistoryCursor = input?.commentHistoryCursor

    // 旧 checkpoint 的 page 语义是「下一页」，新语义是「当前页」：倒退一页重跑，避免漏项。
    const legacyVisited = (input as { visitedMblogIds?: unknown } | undefined)?.visitedMblogIds
    if (legacyVisited !== undefined && phase === 'timeline' && page !== undefined)
      page = Math.max(1, page - 1)

    const cp: ArchiveCheckpoint = { uid, phase, page, lastTimelineMblogId, favoritesPage }
    // 仅在续跑对应阶段时带上该阶段的游标，避免把无关字段写回其它阶段（checkpoint 保持恒定大小）。
    if (phase === 'likes' && input?.likesPage !== undefined)
      cp.likesPage = input.likesPage
    if (phase === 'images' && input?.imagesCursor !== undefined)
      cp.imagesCursor = input.imagesCursor
    if (phase === 'videos' && input?.videosCursor !== undefined)
      cp.videosCursor = input.videosCursor
    if (phase === 'comments' && input?.commentHistoryCursor !== undefined)
      cp.commentHistoryCursor = input.commentHistoryCursor
    // 续跑日期切片时保留 slice 游标；新流程不会把这些字段写进 mymblog checkpoint。
    if (input?.sliceEnd !== undefined)
      cp.sliceEnd = input.sliceEnd
    if (input?.slicePage !== undefined)
      cp.slicePage = input.slicePage
    if (input?.sliceWindow !== undefined)
      cp.sliceWindow = input.sliceWindow

    // P1-3/P1-4/P1-6：进度、错误策略、评论。
    const includeComments = options.includeComments ?? false
    const commentsDep = this.deps.tweets.comments?.bind(this.deps.tweets)
    if (includeComments && !commentsDep) {
      throw new InvalidConfigError('ArchiveService includeComments=true requires deps.tweets.comments.', {
        field: 'tweets.comments',
      })
    }

    // D1 / D2：新的归档数据源。默认关闭；开启时必须注入对应依赖。
    const likesDep = this.deps.likes?.fetchRawPage.bind(this.deps.likes)
    if (includeLikes && !likesDep) {
      throw new InvalidConfigError('ArchiveService includeLikes=true requires deps.likes.fetchRawPage.', {
        field: 'likes.fetchRawPage',
      })
    }
    const commentHistoryDep = this.deps.commentHistory?.fetchRawPage.bind(this.deps.commentHistory)
    if (includeCommentHistory && !commentHistoryDep) {
      throw new InvalidConfigError('ArchiveService includeCommentHistory=true requires deps.commentHistory.fetchRawPage.', {
        field: 'commentHistory.fetchRawPage',
      })
    }

    // D4 / D5：媒体集合。默认关闭；开启时必须注入对应原始页依赖。
    const imagePageDep = this.deps.media?.fetchRawImagePage.bind(this.deps.media)
    if (includeImages && !imagePageDep) {
      throw new InvalidConfigError('ArchiveService includeImages=true requires deps.media.fetchRawImagePage.', {
        field: 'media.fetchRawImagePage',
      })
    }
    const videoPageDep = this.deps.media?.fetchRawVideoPage.bind(this.deps.media)
    if (includeVideos && !videoPageDep) {
      throw new InvalidConfigError('ArchiveService includeVideos=true requires deps.media.fetchRawVideoPage.', {
        field: 'media.fetchRawVideoPage',
      })
    }

    await this.assertAccountLevelSources([uid], { includeFavorites, includeCommentHistory })

    const maxRetries = options.maxRetries ?? 1
    const retryDelayMs = options.retryDelayMs ?? 0
    const repostErrorPolicy = options.repostErrorPolicy ?? 'skip'
    const commentsErrorPolicy = options.commentsErrorPolicy ?? 'skip'
    const likesErrorPolicy = options.likesErrorPolicy ?? 'abort'
    const commentHistoryErrorPolicy = options.commentHistoryErrorPolicy ?? 'abort'
    const imagesErrorPolicy = options.imagesErrorPolicy ?? 'abort'
    const videosErrorPolicy = options.videosErrorPolicy ?? 'abort'
    const progressState = { processed: 0 }
    const archiveTraceId = `${Date.now()}-archive-${uid}`

    // 阶段顺序固定：timeline → likes → comments → favorites → images → videos → done。
    // 具体启用哪些阶段由选项决定；checkpoint 停在未启用阶段时自动跳到下一个启用阶段。
    const canonicalPhases: ArchivePhase[] = ['timeline', 'likes', 'comments', 'favorites', 'images', 'videos', 'done']
    const enabledPhases: ArchivePhase[] = [
      'timeline',
      ...(includeLikes ? ['likes' as const] : []),
      ...(includeCommentHistory ? ['comments' as const] : []),
      ...(includeFavorites ? ['favorites' as const] : []),
      ...(includeImages ? ['images' as const] : []),
      ...(includeVideos ? ['videos' as const] : []),
      'done',
    ]

    /** 把 checkpoint 收敛到当前阶段（清掉其它阶段的游标，保持恒定大小）。 */
    const preparePhaseCheckpoint = (): void => {
      cp.phase = phase
      if (phase !== 'timeline') {
        cp.page = undefined
        cp.lastTimelineMblogId = undefined
        delete cp.sliceEnd
        delete cp.slicePage
        delete cp.sliceWindow
      }
      else {
        cp.page = page
        cp.lastTimelineMblogId = lastTimelineMblogId
      }
      cp.favoritesPage = undefined
      delete cp.likesPage
      delete cp.commentHistoryCursor
      delete cp.imagesCursor
      delete cp.videosCursor
      if (phase === 'likes') {
        cp.likesPage = likesPage ?? 1
        likesPage = cp.likesPage
      }
      if (phase === 'comments' && commentHistoryCursor !== undefined)
        cp.commentHistoryCursor = commentHistoryCursor
      if (phase === 'favorites') {
        cp.favoritesPage = favoritesPage ?? 1
        favoritesPage = cp.favoritesPage
      }
      if (phase === 'images' && imagesCursor !== undefined)
        cp.imagesCursor = imagesCursor
      if (phase === 'videos' && videosCursor !== undefined)
        cp.videosCursor = videosCursor
    }

    const advancePhase = (): void => {
      const currentIndex = canonicalPhases.indexOf(phase)
      const rest = currentIndex >= 0 ? canonicalPhases.slice(currentIndex + 1) : canonicalPhases
      phase = rest.find(candidate => enabledPhases.includes(candidate)) ?? 'done'
      preparePhaseCheckpoint()
    }

    preparePhaseCheckpoint()
    // checkpoint 停在未启用阶段时（例如上次启用了 likes、本次关闭）跳到下一个启用阶段。
    if (phase !== 'done' && !enabledPhases.includes(phase)) {
      const currentIndex = canonicalPhases.indexOf(phase)
      phase = canonicalPhases.slice(currentIndex + 1).find(candidate => enabledPhases.includes(candidate)) ?? 'done'
      preparePhaseCheckpoint()
    }

    const reportProgress = async (extra: {
      total?: number
      remaining?: number
      source?: ArchiveProgress['source']
      page?: number
    }): Promise<void> => {
      const progress: ArchiveProgress = {
        uid,
        phase: cp.phase,
        processed: progressState.processed,
        ...extra,
      }
      try {
        await options.onProgress?.(progress)
      }
      catch {
        // 进度回调异常不影响归档。
      }
      try {
        await this.deps.telemetry?.emit({
          event_name: 'archive_progress',
          timestamp: Date.now(),
          trace_id: archiveTraceId,
          uid,
          phase: cp.phase,
          processed: progress.processed,
          total: extra.total,
          remaining: extra.remaining,
          source: extra.source,
          page: extra.page,
        })
      }
      catch {
        // telemetry must not break SDK behavior
      }
    }

    const emitItemError = async (
      error: unknown,
      context: ArchiveItemErrorContext,
      action: ArchiveErrorAction,
    ): Promise<void> => {
      try {
        await this.deps.telemetry?.emit({
          event_name: 'archive_item_error',
          timestamp: Date.now(),
          trace_id: archiveTraceId,
          uid,
          phase: context.phase,
          stage: context.stage,
          source: context.source,
          mblogId: context.mblogId,
          parentMblogId: context.parentMblogId,
          page: context.page,
          action,
          ...toErrorTelemetryFields(error),
        })
      }
      catch {
        // telemetry must not break SDK behavior
      }
    }

    type ErrorContextInput = Omit<ArchiveItemErrorContext, 'uid' | 'phase'>

    const runWithPolicy = async <T>(
      fn: () => Promise<T>,
      context: ErrorContextInput,
      fallback: ArchiveErrorAction,
    ): Promise<T | undefined> => {
      let attempt = 0
      while (true) {
        try {
          return await fn()
        }
        catch (error) {
          const fullContext: ArchiveItemErrorContext = { uid, phase: cp.phase, ...context }
          let requested: ArchiveErrorAction | undefined
          try {
            requested = (await options.onItemError?.(error, fullContext)) ?? undefined
          }
          catch {
            // 回调异常不应掩盖原始错误；退回默认策略。
          }
          const action = requested ?? fallback
          const willRetry = action === 'retry' && isRetryableError(error) && attempt < maxRetries
          await emitItemError(error, fullContext, willRetry ? 'retry' : action)

          if (willRetry) {
            attempt += 1
            if (retryDelayMs > 0)
              await sleep(retryDelayMs)
            continue
          }

          if (action === 'abort' || (action === 'retry' && fallback === 'abort'))
            throw error
          return undefined
        }
      }
    }

    const fetchComments = async (
      mblogId: string,
      context: Omit<ErrorContextInput, 'stage'> & { page?: number },
    ): Promise<ITweetComment[]> => {
      if (!commentsDep)
        return []

      const out: ITweetComment[] = []
      const seen = new Set<string>()
      let maxId: number | undefined
      let pages = 0
      let collected = 0
      let total: number | undefined
      const maxCommentPages = options.maxCommentPagesPerTweet ?? Number.POSITIVE_INFINITY

      while (pages < maxCommentPages) {
        const response = await runWithPolicy(
          () => commentsDep(mblogId, {
            count: options.commentCount ?? 20,
            max_id: maxId,
            uid,
          }),
          { ...context, stage: 'comments', mblogId },
          commentsErrorPolicy,
        )
        if (!response)
          break

        const list = response.data || []
        if (list.length === 0)
          break

        for (const rawComment of list) {
          const id = String((rawComment as { idstr?: unknown, id?: unknown }).idstr
            ?? (rawComment as { id?: unknown }).id
            ?? '')
          if (id) {
            if (seen.has(id))
              continue
            seen.add(id)
          }
          out.push(normalizeComment(rawComment))
        }

        collected += list.length
        total = response.total_number ?? total
        const next = typeof response.max_id === 'number' ? response.max_id : undefined
        if (!next || next === maxId)
          break
        if (total !== undefined && collected >= total)
          break
        maxId = next
        pages += 1
      }

      return out
    }

    /**
     * 只预取单条微博的评论网络请求；归一化（`new Tweet`）仍由调用方在
     * `onRaw` 之后执行，保证 raw 回调先于归一化的契约。
     */
    const fetchItemComments = async (
      raw: TimelineRawItem,
      source: ArchiveItem['source'],
      page?: number,
      parentMblogId?: string,
    ): Promise<ITweetComment[]> => {
      // 评论只挂到 timeline / repost 项；收藏、点赞、历史评论不额外拉评论。
      if (!includeComments || (source !== 'timeline' && source !== 'repost'))
        return []
      return await fetchComments(raw.mblogid, {
        source,
        page,
        parentMblogId,
      })
    }

    const prepareTweet = async (
      raw: TimelineRawItem,
      source: ArchiveItem['source'],
      page?: number,
      parentMblogId?: string,
    ): Promise<Tweet> => {
      const tweet = new Tweet(raw)
      const comments = await fetchItemComments(raw, source, page, parentMblogId)
      if (comments.length > 0)
        tweet.comments = comments
      return tweet
    }

    const fetchRepostPage = (parentMblogId: string, repostPage: number): Promise<RepostTimelineResponse | undefined> => runWithPolicy(
      () => this.deps.tweets.getReposts(parentMblogId, { page: repostPage }),
      { stage: 'reposts', source: 'repost', parentMblogId, page: repostPage },
      repostErrorPolicy,
    )

    interface PreparedTimelineItem {
      comments: Promise<ITweetComment[]>
      firstRepostPage?: Promise<RepostTimelineResponse | undefined>
    }

    /**
     * 启动单条 timeline 项的独立子请求：评论链与转发首页互不依赖，一起发。
     *
     * 预取窗口内的任务可能因早停 / 消费端中断而永远不被 await，先挂空 catch
     * 避免 unhandled rejection；调用方在 `finally` 用 `Promise.allSettled` 收敛。
     */
    const startTimelineItem = (item: TimelineRawItem, itemPage: number): PreparedTimelineItem => {
      const comments = fetchItemComments(item, 'timeline', itemPage)
      const firstRepostPage = includeReposts ? fetchRepostPage(item.mblogid, 1) : undefined
      void comments.catch(() => {})
      void firstRepostPage?.catch(() => {})
      return { comments, firstRepostPage }
    }

    /** 预取窗口任务收敛，避免提前退出时留下浮动 Promise。 */
    const settlePrepared = async (prepared: Map<number, PreparedTimelineItem>): Promise<void> => {
      const pending: Promise<unknown>[] = []
      for (const task of prepared.values()) {
        pending.push(task.comments)
        if (task.firstRepostPage)
          pending.push(task.firstRepostPage)
      }
      await Promise.allSettled(pending)
    }

    // 增量 / 原创过滤：timeline 阶段逐条判断「产出 / 跳过 / 停止」。
    let incrementalReached = false
    const incrementalAction = (raw: TimelineRawItem): 'emit' | 'skip' | 'stop' => {
      if (stopAtMblogId !== undefined && raw.mblogid === stopAtMblogId)
        return 'stop'
      const pinned = isPinnedRaw(raw)
      // 置顶微博可能发布时间很早，不参与时间边界判断（否则一上来就被误判为到底）。
      if (incrementalSince !== undefined && !pinned) {
        const ts = parseCreatedAt(raw.created_at)
        if (ts !== undefined && ts < incrementalSince)
          return 'stop'
      }
      if (pinned && skipPinned)
        return 'skip'
      if (originalOnly && !isOriginalRaw(raw))
        return 'skip'
      return 'emit'
    }

    // Phase 1a: mymblog（page 游标；转发内联，P1-2）
    // 已进入日期切片阶段（sliceEnd 存在）时不重跑 mymblog。
    let oldestTimelineTs: number | undefined
    let mymblogTotal: number | undefined
    let mymblogSeen = 0
    const startedFromBeginning = input?.page === undefined
      && input?.lastTimelineMblogId === undefined
      && input?.sliceEnd === undefined

    if (phase === 'timeline')
      await reportProgress({ source: timelineSource === 'search' ? 'search' : 'mymblog' })

    if (phase === 'timeline' && timelineSource === 'mymblog' && input?.sliceEnd === undefined) {
      let currentPage = page ?? 1
      let pages = 0
      let previousPageIds = new Set<string>()

      while (pages < maxPages) {
        const raw = await runWithPolicy(
          () => this.deps.tweets.fetchRawUserTimelinePage(uid, currentPage, count),
          { stage: 'timeline', source: 'timeline', page: currentPage },
          'abort',
        )
        if (!raw)
          break
        const list = uniqueByMblogId(raw.data.list || [])
        const ids = list.map(item => item.mblogid)
        if (ids.length === 0)
          break // 空列表 = 到底（真实 API 翻到底返回 list: []）
        if (isRepeatedPage(ids, previousPageIds))
          break // 上游忽略 page 重复返回上一页 → 视为到底

        const total = parseTotal(raw.data.total)
        if (total !== undefined && total > 0)
          mymblogTotal = Math.max(mymblogTotal ?? 0, total)
        mymblogSeen += list.length
        for (const item of list) {
          const ts = parseCreatedAt(item.created_at)
          if (ts !== undefined && (oldestTimelineTs === undefined || ts < oldestTimelineTs))
            oldestTimelineTs = ts
        }

        // 恢复：跳过上次已完整处理（含转发）的项；找不到则整页重跑（重复但不会漏）。
        const resumeAt = lastTimelineMblogId ? ids.indexOf(lastTimelineMblogId) : -1
        const pending = resumeAt >= 0 ? list.slice(resumeAt + 1) : list
        // skip / stop 是纯判定，先算出可预取范围，避免提前推进 checkpoint。
        const actions = pending.map(item => incrementalAction(item))
        const stopAt = actions.indexOf('stop')
        const limit = stopAt >= 0 ? stopAt : pending.length
        const prepared = new Map<number, PreparedTimelineItem>()
        /** 滑窗预取：当前项开始等待时，后 N-1 项的独立子请求已经在路上。 */
        const prefetch = (index: number): void => {
          const end = Math.min(limit, index + concurrency)
          for (let offset = index; offset < end; offset++) {
            if (actions[offset] !== 'emit' || prepared.has(offset))
              continue
            prepared.set(offset, startTimelineItem(pending[offset], currentPage))
          }
        }

        try {
          for (let index = 0; index < pending.length; index++) {
            if (index >= limit) {
              incrementalReached = true
              break
            }
            const item = pending[index]
            if (actions[index] === 'skip') {
              // 跳过但推进断点，避免下次从头重复扫描。
              cp.phase = 'timeline'
              cp.page = currentPage
              cp.lastTimelineMblogId = item.mblogid
              lastTimelineMblogId = item.mblogid
              continue
            }

            await options.onRaw?.(item, { uid, source: 'timeline', mblogId: item.mblogid, page: currentPage })

            prefetch(index)

            cp.phase = 'timeline'
            cp.page = currentPage
            cp.favoritesPage = undefined
            delete cp.sliceEnd
            delete cp.slicePage
            delete cp.sliceWindow
            // 转发完成前仍指向上一条已完成项；中断会重跑当前项（重复但不会漏）。
            cp.lastTimelineMblogId = includeReposts ? lastTimelineMblogId : item.mblogid
            const task = prepared.get(index)!
            const tweet = new Tweet(item)
            const comments = await task.comments
            if (comments.length > 0)
              tweet.comments = comments
            progressState.processed += 1
            yield this.buildItem(item, 'timeline', cp, tweet)

            if (includeReposts) {
              yield* this.streamReposts(item, {
                uid,
                cp,
                maxPages,
                concurrency,
                onRaw: options.onRaw,
                progressState,
                fetchRepostPage,
                fetchItemComments,
              }, task.firstRepostPage)
            }

            lastTimelineMblogId = item.mblogid
            cp.lastTimelineMblogId = lastTimelineMblogId
          }
        }
        finally {
          await settlePrepared(prepared)
        }

        if (incrementalReached)
          break

        previousPageIds = new Set(ids)
        await reportProgress({
          source: 'mymblog',
          total: mymblogTotal,
          remaining: mymblogTotal !== undefined ? Math.max(0, mymblogTotal - mymblogSeen) : undefined,
          page: currentPage,
        })
        currentPage += 1
        pages += 1
      }

      page = currentPage
    }

    // Phase 1b: searchProfile 日期切片（P1-5）
    if (phase === 'timeline' && searchByDate && !incrementalReached) {
      const canSlice = timelineSource === 'search'
        || (includeDateSlices && oldestTimelineTs !== undefined)

      // 仅当能证明 mymblog 已完整时跳过回填；否则宁可多扫一遍更早区间，也不漏数据。
      const mymblogLooksComplete = startedFromBeginning
        && mymblogTotal !== undefined
        && mymblogSeen >= mymblogTotal

      const resumeSliceEnd = input?.sliceEnd
      let sliceEnd = resumeSliceEnd
      if (sliceEnd === undefined && timelineSource === 'search') {
        sliceEnd = options.until ?? Math.floor(Date.now() / 1000)
      }
      else if (sliceEnd === undefined && canSlice && oldestTimelineTs !== undefined && !mymblogLooksComplete) {
        sliceEnd = oldestTimelineTs - 1
      }

      let sliceWindow = input?.sliceWindow ?? options.sliceWindow ?? DEFAULT_SLICE_WINDOW
      let slicePage = input?.slicePage
      let sliceLastId = resumeSliceEnd !== undefined ? lastTimelineMblogId : undefined
      let pages = 0

      while (sliceEnd !== undefined && sliceEnd >= since && pages < maxPages) {
        const sliceStart = Math.max(since, sliceEnd - sliceWindow + 1)

        const first = await runWithPolicy(
          () => searchByDate(uid, {
            page: 1,
            ...(options.searchQuery === undefined ? {} : { q: options.searchQuery }),
            starttime: sliceStart,
            endtime: sliceEnd,
          }),
          { stage: 'timeline', source: 'timeline', page: 1 },
          'abort',
        )
        if (!first)
          break
        const firstList = uniqueByMblogId(first.data.list || [])
        const total = parseTotal(first.data.total)

        // 空切片：直接跨过，并扩大窗口加速扫描长期无内容的区间。
        if (firstList.length === 0 && (total === undefined || total <= 0)) {
          sliceEnd = sliceStart - 1
          sliceWindow = Math.min(MAX_SLICE_WINDOW, sliceWindow * 2)
          continue
        }

        // 切片太密：分页会触达上游 window 上限。缩小窗口后重试同一区间，
        // 优先处理靠前的（较新）子区间，避免整段漏数据。
        if (total !== undefined && total > maxSliceItems && sliceWindow > MIN_SLICE_WINDOW) {
          sliceWindow = Math.max(MIN_SLICE_WINDOW, Math.floor(sliceWindow / 2))
          continue
        }

        let currentPage = slicePage ?? 1
        let previousPageIds = new Set<string>()
        let previousFirstTs: number | undefined
        let collected = 0
        const resumePage = currentPage
        let currentLastId = sliceLastId

        while (pages < maxPages) {
          const response = currentPage === 1
            ? first
            : await runWithPolicy(
                () => searchByDate(uid, {
                  page: currentPage,
                  ...(options.searchQuery === undefined ? {} : { q: options.searchQuery }),
                  starttime: sliceStart,
                  endtime: sliceEnd,
                }),
                { stage: 'timeline', source: 'timeline', page: currentPage },
                'abort',
              )
          if (!response)
            break
          const rawList = response.data.list || []
          const list = uniqueByMblogId(rawList)
          const ids = list.map(item => item.mblogid)
          if (ids.length === 0)
            break
          if (currentPage > 1 && isRepeatedPage(ids, previousPageIds))
            break

          const firstTs = parseCreatedAt(list[0]?.created_at)
          // 上游 page 越界后会重置到较新的区间：日期不再变旧 → 视为到底，避免重复/漏页。
          if (currentPage > 1 && previousFirstTs !== undefined && firstTs !== undefined && firstTs > previousFirstTs)
            break

          // 恢复：只在进入续跑页时按 lastTimelineMblogId 跳过已处理项。
          const resumeAt = currentLastId && currentPage === resumePage ? ids.indexOf(currentLastId) : -1
          const pending = resumeAt >= 0 ? list.slice(resumeAt + 1) : list
          const actions = pending.map(item => incrementalAction(item))
          const stopAt = actions.indexOf('stop')
          const limit = stopAt >= 0 ? stopAt : pending.length
          const prepared = new Map<number, PreparedTimelineItem>()
          const prefetch = (index: number): void => {
            const end = Math.min(limit, index + concurrency)
            for (let offset = index; offset < end; offset++) {
              if (actions[offset] !== 'emit' || prepared.has(offset))
                continue
              prepared.set(offset, startTimelineItem(pending[offset], currentPage))
            }
          }

          try {
            for (let index = 0; index < pending.length; index++) {
              if (index >= limit) {
                incrementalReached = true
                break
              }
              const item = pending[index]
              if (actions[index] === 'skip') {
                cp.phase = 'timeline'
                cp.sliceEnd = sliceEnd
                cp.slicePage = currentPage
                cp.sliceWindow = sliceWindow
                cp.lastTimelineMblogId = item.mblogid
                currentLastId = item.mblogid
                continue
              }

              await options.onRaw?.(item, { uid, source: 'timeline', mblogId: item.mblogid, page: currentPage })

              prefetch(index)

              cp.phase = 'timeline'
              cp.page = undefined
              cp.favoritesPage = undefined
              cp.sliceEnd = sliceEnd
              cp.slicePage = currentPage
              cp.sliceWindow = sliceWindow
              cp.lastTimelineMblogId = includeReposts ? currentLastId : item.mblogid
              const task = prepared.get(index)!
              const tweet = new Tweet(item)
              const comments = await task.comments
              if (comments.length > 0)
                tweet.comments = comments
              progressState.processed += 1
              yield this.buildItem(item, 'timeline', cp, tweet)

              if (includeReposts) {
                yield* this.streamReposts(item, {
                  uid,
                  cp,
                  maxPages,
                  concurrency,
                  onRaw: options.onRaw,
                  progressState,
                  fetchRepostPage,
                  fetchItemComments,
                }, task.firstRepostPage)
              }

              currentLastId = item.mblogid
              cp.lastTimelineMblogId = currentLastId
            }
          }
          finally {
            await settlePrepared(prepared)
          }

          if (incrementalReached)
            break

          collected += list.length
          previousPageIds = new Set(ids)
          previousFirstTs = firstTs ?? previousFirstTs
          await reportProgress({
            source: 'search',
            total,
            remaining: total !== undefined ? Math.max(0, total - collected) : undefined,
            page: currentPage,
          })

          if (total !== undefined && total > 0 && collected >= total)
            break

          currentPage += 1
          pages += 1
        }

        if (incrementalReached)
          break

        pages += 1
        sliceEnd = sliceStart - 1
        slicePage = 1
        sliceLastId = undefined
        // 内容稀疏时逐步放大窗口；遇到密集区间会自动再缩小。
        if (total !== undefined && total < maxSliceItems / 8)
          sliceWindow = Math.min(MAX_SLICE_WINDOW, sliceWindow * 2)

        cp.sliceEnd = sliceEnd
        cp.slicePage = slicePage
        cp.sliceWindow = sliceWindow
        cp.lastTimelineMblogId = undefined
      }
    }

    // timeline 结束：进入下一个启用的阶段（likes → comments → favorites → images → videos → done）
    if (phase === 'timeline')
      advancePhase()

    // Phase 1c: likes（page 翻页；上游无 total）
    if (phase === 'likes' && includeLikes && likesDep) {
      let currentPage = likesPage ?? 1
      let pages = 0
      let previousPageIds = new Set<string>()

      while (pages < maxPages) {
        const raw = await runWithPolicy(
          () => likesDep(uid, currentPage),
          { stage: 'likes', source: 'like', page: currentPage },
          likesErrorPolicy,
        )
        if (!raw)
          break
        const list = uniqueByMblogId(raw.data.list || [])
        const ids = list.map(item => item.mblogid)
        if (ids.length === 0)
          break // 空页 = 到底（上游越界页返回 list: []）
        if (isRepeatedPage(ids, previousPageIds))
          break // 上游忽略 page 重复返回同一页

        for (const item of list) {
          await options.onRaw?.(item, { uid, source: 'like', mblogId: item.mblogid, page: currentPage })

          cp.phase = 'likes'
          cp.page = undefined
          cp.lastTimelineMblogId = undefined
          cp.favoritesPage = undefined
          cp.likesPage = currentPage
          delete cp.commentHistoryCursor
          delete cp.sliceEnd
          delete cp.slicePage
          delete cp.sliceWindow
          const tweet = await prepareTweet(item, 'like', currentPage)
          progressState.processed += 1
          yield this.buildItem(item, 'like', cp, tweet)
        }

        previousPageIds = new Set(ids)
        await reportProgress({ source: 'likes', page: currentPage })
        likesPage = currentPage + 1
        currentPage += 1
        pages += 1
      }
    }

    if (phase === 'likes')
      advancePhase()

    // Phase 1d: comments（max_id 游标；评论本体挂到 item.comment）
    if (phase === 'comments' && includeCommentHistory && commentHistoryDep) {
      let cursor = commentHistoryCursor
      let pages = 0
      const seen = new Set<string>()

      while (pages < maxPages) {
        const requestOptions = cursor !== undefined ? { maxId: cursor } : {}
        const raw = await runWithPolicy(
          () => commentHistoryDep(requestOptions),
          { stage: 'commentHistory', source: 'comment', page: pages + 1 },
          commentHistoryErrorPolicy,
        )
        if (!raw)
          break
        const rawComments = raw.data.comments || []
        if (rawComments.length === 0)
          break // 空页 = 到底
        const nextCursor = parseCursor(raw.data.next_cursor)

        let fresh = 0
        for (const rawComment of rawComments) {
          const status = (rawComment as { status?: TimelineRawItem }).status
          if (!status || typeof status.mblogid !== 'string')
            continue

          const commentId = String(rawComment.idstr || rawComment.id || '')
          if (commentId) {
            if (seen.has(commentId))
              continue
            seen.add(commentId)
          }

          await options.onRaw?.(rawComment, {
            uid,
            source: 'comment',
            mblogId: status.mblogid,
            page: pages + 1,
          })

          cp.phase = 'comments'
          cp.page = undefined
          cp.lastTimelineMblogId = undefined
          cp.favoritesPage = undefined
          delete cp.likesPage
          if (cursor !== undefined)
            cp.commentHistoryCursor = cursor
          else
            delete cp.commentHistoryCursor
          delete cp.sliceEnd
          delete cp.slicePage
          delete cp.sliceWindow

          const tweet = new Tweet(status)
          const item = this.buildItem(status, 'comment', cp, tweet)
          item.comment = normalizeComment(rawComment)
          progressState.processed += 1
          fresh += 1
          yield item
        }

        pages += 1
        if (fresh === 0)
          break // 整页都是无效 / 重复项
        const total = parseTotal(raw.data.total_number)
        await reportProgress({
          source: 'comments',
          total,
          remaining: total !== undefined ? Math.max(0, total - progressState.processed) : undefined,
          page: pages,
        })

        if (nextCursor === 0)
          break // 到底
        if (cursor !== undefined && nextCursor === cursor)
          break // 游标不前进
        cursor = nextCursor
      }
    }

    if (phase === 'comments')
      advancePhase()

    // Phase 2: favorites（page 翻页）
    if (phase === 'favorites' && includeFavorites) {
      let currentPage = favoritesPage ?? 1
      let pages = 0
      let previousPageIds = new Set<string>()

      while (pages < maxPages) {
        const favs = await runWithPolicy(
          () => this.deps.favorites.getFavorites(uid, currentPage),
          { stage: 'favorites', source: 'favorite', page: currentPage },
          'abort',
        )
        if (!favs)
          break
        const rawFavorites = favs.data.status || []
        const list = uniqueByMblogId(rawFavorites)
        const ids = list.map(item => item.mblogid)
        if (ids.length === 0)
          break
        if (isRepeatedPage(ids, previousPageIds))
          break

        for (const item of list) {
          await options.onRaw?.(item, { uid, source: 'favorite', mblogId: item.mblogid, page: currentPage })

          cp.phase = 'favorites'
          cp.page = undefined
          cp.lastTimelineMblogId = undefined
          cp.favoritesPage = currentPage
          delete cp.likesPage
          delete cp.commentHistoryCursor
          const tweet = await prepareTweet(item, 'favorite', currentPage)
          progressState.processed += 1
          yield this.buildItem(item, 'favorite', cp, tweet)
        }

        previousPageIds = new Set(ids)
        const total = favs.data.total_number ?? 0
        const perPage = rawFavorites.length
        await reportProgress({
          source: 'favorites',
          total,
          remaining: Math.max(0, total - currentPage * perPage),
          page: currentPage,
        })
        if (currentPage * perPage >= total || perPage === 0)
          break
        currentPage += 1
        pages += 1
      }

      if (phase === 'favorites')
        advancePhase()
    }

    // Phase 3: images（图片墙，sinceid 游标）
    if (phase === 'images' && includeImages && imagePageDep) {
      let cursor = imagesCursor
      let pages = 0
      const seen = new Set<string>()

      while (pages < maxPages) {
        const raw = await runWithPolicy(
          () => imagePageDep(uid, cursor === undefined ? {} : { sinceId: cursor }),
          { stage: 'images', source: 'image', page: pages + 1 },
          imagesErrorPolicy,
        )
        if (!raw)
          break

        const rawList = raw.data.list || []
        if (rawList.length === 0)
          break
        const nextCursor = normalizeCursorString(raw.data.since_id)

        for (const rawItem of rawList) {
          const asset = normalizeImageWallItem(rawItem)
          if (!asset.id || seen.has(asset.id))
            continue
          seen.add(asset.id)

          const mblogId = asset.sourceMblogId ?? asset.sourceTweetId ?? asset.id
          await options.onRaw?.(rawItem, { uid, source: 'image', mblogId, page: pages + 1 })

          cp.phase = 'images'
          cp.page = undefined
          cp.lastTimelineMblogId = undefined
          cp.favoritesPage = undefined
          delete cp.likesPage
          delete cp.commentHistoryCursor
          delete cp.sliceEnd
          delete cp.slicePage
          delete cp.sliceWindow
          delete cp.videosCursor
          if (cursor !== undefined)
            cp.imagesCursor = cursor
          else
            delete cp.imagesCursor

          progressState.processed += 1
          yield this.buildMediaItem(rawItem, 'image', cp, asset, mblogId)
        }

        pages += 1
        await reportProgress({ source: 'images', page: pages })

        // 全页重复但游标还在前进时继续翻页；游标不动才是到底。
        if (nextCursor === undefined || nextCursor === cursor)
          break
        cursor = nextCursor
        imagesCursor = nextCursor
      }
    }

    if (phase === 'images')
      advancePhase()

    // Phase 4: videos（视频瀑布，cursor 游标；条目本身是微博）
    if (phase === 'videos' && includeVideos && videoPageDep) {
      let cursor = videosCursor
      let pages = 0
      const seen = new Set<string>()

      while (pages < maxPages) {
        const raw = await runWithPolicy(
          () => videoPageDep(uid, cursor === undefined ? {} : { cursor }),
          { stage: 'videos', source: 'video', page: pages + 1 },
          videosErrorPolicy,
        )
        if (!raw)
          break

        const rawList = raw.data.list || []
        if (rawList.length === 0)
          break
        const nextCursor = normalizeCursorString(raw.data.next_cursor)

        for (const rawItem of rawList) {
          const asset = normalizeWaterfallVideo(rawItem)
          if (!asset || seen.has(asset.id))
            continue
          seen.add(asset.id)

          const mblogId = rawItem.mblogid
          await options.onRaw?.(rawItem, { uid, source: 'video', mblogId, page: pages + 1 })

          cp.phase = 'videos'
          cp.page = undefined
          cp.lastTimelineMblogId = undefined
          cp.favoritesPage = undefined
          delete cp.likesPage
          delete cp.commentHistoryCursor
          delete cp.sliceEnd
          delete cp.slicePage
          delete cp.sliceWindow
          delete cp.imagesCursor
          if (cursor !== undefined)
            cp.videosCursor = cursor
          else
            delete cp.videosCursor

          const tweet = new Tweet(rawItem)
          const item = this.buildItem(rawItem, 'video', cp, tweet)
          item.asset = asset
          progressState.processed += 1
          yield item
        }

        pages += 1
        await reportProgress({ source: 'videos', page: pages })

        if (nextCursor === undefined || nextCursor === cursor)
          break
        cursor = nextCursor
        videosCursor = nextCursor
      }
    }

    if (phase === 'videos')
      advancePhase()

    if (cp.phase === 'done')
      await reportProgress({ source: 'done' })
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

  /** 构造磁盘条目；checkpoint 使用浅拷贝，避免后续 item 修改已 yield 的快照。 */
  private buildItem(
    raw: TimelineRawItem,
    source: ArchiveItem['source'],
    cp: ArchiveCheckpoint,
    tweet: Tweet = new Tweet(raw),
  ): ArchiveItem {
    return {
      schemaVersion: TWEET_CONTRACT_VERSION,
      source,
      mblogId: raw.mblogid,
      tweet,
      schemaDigest: stripVolatileKeys(raw),
      checkpoint: { ...cp },
    }
  }

  /** 构造媒体条目（图片墙没有完整微博，`tweet` 缺省）。 */
  private buildMediaItem(
    raw: unknown,
    source: 'image' | 'video',
    cp: ArchiveCheckpoint,
    asset: IUserMediaAsset,
    mblogId?: string,
  ): ArchiveItem {
    return {
      schemaVersion: TWEET_CONTRACT_VERSION,
      source,
      ...(mblogId === undefined ? {} : { mblogId }),
      asset,
      schemaDigest: stripVolatileKeys(raw),
      checkpoint: { ...cp },
    }
  }

  /**
   * 内联某条微博的转发页（P1-2），转发本身不改变 timeline 游标语义。
   *
   * 第一页可由调用方预取（与父微博的评论链并行）；页内各条转发的评论
   * 也按 `concurrency` 窗口预取，产出顺序不变。
   */
  private async* streamReposts(
    parent: TimelineRawItem,
    context: {
      uid: string
      cp: ArchiveCheckpoint
      maxPages: number
      concurrency: number
      onRaw?: ArchiveStreamOptions['onRaw']
      progressState: { processed: number }
      fetchRepostPage: (parentMblogId: string, page: number) => Promise<RepostTimelineResponse | undefined>
      fetchItemComments: (
        raw: TimelineRawItem,
        source: ArchiveItem['source'],
        page?: number,
        parentMblogId?: string,
      ) => Promise<ITweetComment[]>
    },
    prefetchedFirstPage?: Promise<RepostTimelineResponse | undefined>,
  ): AsyncIterableIterator<ArchiveItem> {
    const { uid, cp, maxPages, concurrency, onRaw, progressState, fetchRepostPage, fetchItemComments } = context
    let repostPage = 1
    let repostPages = 0
    let previousRepostIds = new Set<string>()

    while (repostPages < maxPages) {
      const reposts = repostPage === 1 && prefetchedFirstPage !== undefined
        ? await prefetchedFirstPage
        : await fetchRepostPage(parent.mblogid, repostPage)
      if (!reposts)
        break // P1-4：转发页失败按策略 skip，继续下一条 timeline item
      const rawReposts = reposts.data || []
      const repostList = uniqueByMblogId(rawReposts)
      const repostIds = repostList.map(repost => repost.mblogid)
      if (repostIds.length === 0)
        break
      if (isRepeatedPage(repostIds, previousRepostIds))
        break

      for (let offset = 0; offset < repostList.length; offset += concurrency) {
        const chunk = repostList.slice(offset, offset + concurrency)
        const commentsList = chunk.map((repost) => {
          const comments = fetchItemComments(repost, 'repost', repostPage, parent.mblogid)
          void comments.catch(() => {})
          return comments
        })
        try {
          for (let index = 0; index < chunk.length; index++) {
            const repost = chunk[index]
            await onRaw?.(repost, {
              uid,
              source: 'repost',
              mblogId: repost.mblogid,
              page: repostPage,
              parentMblogId: parent.mblogid,
            })
            const tweet = new Tweet(repost)
            const comments = await commentsList[index]
            if (comments.length > 0)
              tweet.comments = comments
            progressState.processed += 1
            yield this.buildItem(repost, 'repost', cp, tweet)
          }
        }
        finally {
          await Promise.allSettled(commentsList)
        }
      }

      previousRepostIds = new Set(repostIds)
      const total = reposts.total_number ?? 0
      const perPage = rawReposts.length
      if (repostPage * perPage >= total || perPage === 0)
        break
      repostPage += 1
      repostPages += 1
    }
  }
}
