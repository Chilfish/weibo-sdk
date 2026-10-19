import type { FavoritesResponse } from '../endpoints/favorite'
import type { BuildCommentsResponse, MyMblogResponse, RepostTimelineResponse, SearchProfileResponse } from '../endpoints/tweet'
import type { ITweetComment, TweetContractVersion } from '~/types/domain/ITweet'
import type { WeiboSDKTelemetry } from '~/types/telemetry'
import { normalizeComment, Tweet } from '~/models/data/Tweet'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { TWEET_CONTRACT_VERSION } from '~/types/domain/ITweet'
import { stripVolatileKeys } from '~/utils/structure'

/**
 * 归档进度类型。
 *
 * `timeline`（用户微博 + 内联转发；mymblog 翻到底后可继续用 searchProfile 日期切片）
 * → `favorites`（收藏，page）→ `done`
 *
 * `reposts` 仅用于兼容 P1-2 之前的旧 checkpoint；新流程不再产生该阶段。
 */
export type ArchivePhase = 'timeline' | 'reposts' | 'favorites' | 'done'

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
export type ArchiveErrorStage = 'comments' | 'reposts' | 'timeline' | 'favorites'

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
  /** 当前进度数据源：mymblog / search / reposts / favorites / done */
  source?: 'mymblog' | 'search' | 'reposts' | 'favorites' | 'done'
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
 * - `lastMblogId`：仅兼容旧 `phase:'reposts'` checkpoint，新流程不产生。
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
  /** P1-5 日期切片：当前切片包含的结束时间（unix 秒，含） */
  sliceEnd?: number
  /** P1-5 日期切片：当前 searchProfile 页码 */
  slicePage?: number
  /** P1-5 日期切片：自适应窗口大小（秒） */
  sliceWindow?: number
  /**
   * @deprecated P1-2 之前的 reposts 阶段断点字段；仅用于兼容旧 checkpoint。
   */
  lastMblogId?: string
}

/**
 * 归档流产出项（磁盘条目信封，K1 / P0-1）。
 *
 * `schemaVersion` 为 ITweet 存档契约版本（与包版本解耦），落盘条目据此自描述、
 * 下游可按版本迁移（规则与迁移策略见 docs/engineering/contract-itweet-v1.md）；
 * `tweet` 为归一化模型；`schemaDigest` 为 raw 项的结构快照（A7，`stripVolatileKeys`），
 * 用于检测上游字段漂移（同一源同一时期 digest 应稳定）——注意与契约版本用途不同。
 */
export interface ArchiveItem {
  schemaVersion: TweetContractVersion
  source: 'timeline' | 'repost' | 'favorite'
  mblogId: string
  tweet: Tweet
  schemaDigest: unknown
  checkpoint: ArchiveCheckpoint
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
    myMblog: (uid: string, page?: number, count?: number) => Promise<MyMblogResponse>
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
  /** P1-3：归档进度 Wide Event（可选；失败不影响归档）。 */
  telemetry?: WeiboSDKTelemetry
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
  /** 每页条数（timeline 阶段，默认 20） */
  count?: number
  /** 每阶段最多翻页数（测试/演示限制，默认不限） */
  maxPagesPerPhase?: number
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
  /** P1-4：可重试错误的最大重试次数（默认 1）。 */
  maxRetries?: number
  /** P1-4：重试间隔毫秒（默认 0）。 */
  retryDelayMs?: number
}

/** 微博上线日（unix 秒）；日期切片默认下界。 */
const WEIBO_EPOCH_SECONDS = Math.floor(Date.UTC(2009, 7, 14) / 1000)
const DEFAULT_SLICE_WINDOW = 30 * 24 * 60 * 60
const MIN_SLICE_WINDOW = 60
const MAX_SLICE_WINDOW = 5 * 365 * 24 * 60 * 60
const DEFAULT_MAX_SLICE_ITEMS = 800

type TimelineRawItem = MyMblogResponse['data']['list'][number]

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
    const includeReposts = options.includeReposts ?? true
    const includeFavorites = options.includeFavorites ?? true
    const maxPages = options.maxPagesPerPhase ?? Number.POSITIVE_INFINITY
    const count = options.count ?? 20
    const timelineSource = options.timelineSource ?? 'mymblog'
    const includeDateSlices = options.includeDateSlices ?? true
    const since = options.since ?? WEIBO_EPOCH_SECONDS
    const maxSliceItems = options.maxSliceItems ?? DEFAULT_MAX_SLICE_ITEMS
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

    // 旧 checkpoint 的 page 语义是「下一页」，新语义是「当前页」：倒退一页重跑，避免漏项。
    const legacyVisited = (input as { visitedMblogIds?: unknown } | undefined)?.visitedMblogIds
    if (legacyVisited !== undefined && phase === 'timeline' && page !== undefined)
      page = Math.max(1, page - 1)

    // P1-2 兼容：旧 reposts 阶段等价于「timeline 已处理到 lastMblogId」，新流程内联转发。
    if (phase === 'reposts') {
      phase = 'timeline'
      page = 1
      lastTimelineMblogId = input?.lastMblogId ?? lastTimelineMblogId
    }

    const cp: ArchiveCheckpoint = { uid, phase, page, lastTimelineMblogId, favoritesPage }
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
    const maxRetries = options.maxRetries ?? 1
    const retryDelayMs = options.retryDelayMs ?? 0
    const repostErrorPolicy = options.repostErrorPolicy ?? 'skip'
    const commentsErrorPolicy = options.commentsErrorPolicy ?? 'skip'
    const progressState = { processed: 0 }
    const archiveTraceId = `${Date.now()}-archive-${uid}`

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

    const prepareTweet = async (
      raw: TimelineRawItem,
      source: ArchiveItem['source'],
      page?: number,
      parentMblogId?: string,
    ): Promise<Tweet> => {
      const tweet = new Tweet(raw)
      if (!includeComments || source === 'favorite')
        return tweet

      const comments = await fetchComments(raw.mblogid, {
        source,
        page,
        parentMblogId,
      })
      if (comments.length > 0)
        tweet.comments = comments
      return tweet
    }

    const fetchRepostPage = (parentMblogId: string, repostPage: number): Promise<RepostTimelineResponse | undefined> => runWithPolicy(
      () => this.deps.tweets.getReposts(parentMblogId, { page: repostPage }),
      { stage: 'reposts', source: 'repost', parentMblogId, page: repostPage },
      repostErrorPolicy,
    )

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
          () => this.deps.tweets.myMblog(uid, currentPage, count),
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

        for (const item of pending) {
          await options.onRaw?.(item, { uid, source: 'timeline', mblogId: item.mblogid, page: currentPage })

          cp.phase = 'timeline'
          cp.page = currentPage
          cp.favoritesPage = undefined
          delete cp.sliceEnd
          delete cp.slicePage
          delete cp.sliceWindow
          // 转发完成前仍指向上一条已完成项；中断会重跑当前项（重复但不会漏）。
          cp.lastTimelineMblogId = includeReposts ? lastTimelineMblogId : item.mblogid
          const tweet = await prepareTweet(item, 'timeline', currentPage)
          progressState.processed += 1
          yield this.buildItem(item, 'timeline', cp, tweet)

          if (includeReposts) {
            yield* this.streamReposts(item, {
              uid,
              cp,
              maxPages,
              onRaw: options.onRaw,
              progressState,
              fetchRepostPage,
              prepareTweet,
            })
          }

          lastTimelineMblogId = item.mblogid
          cp.lastTimelineMblogId = lastTimelineMblogId
        }

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
    if (phase === 'timeline' && searchByDate) {
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

          for (const item of pending) {
            await options.onRaw?.(item, { uid, source: 'timeline', mblogId: item.mblogid, page: currentPage })

            cp.phase = 'timeline'
            cp.page = undefined
            cp.favoritesPage = undefined
            cp.sliceEnd = sliceEnd
            cp.slicePage = currentPage
            cp.sliceWindow = sliceWindow
            cp.lastTimelineMblogId = includeReposts ? currentLastId : item.mblogid
            const tweet = await prepareTweet(item, 'timeline', currentPage)
            progressState.processed += 1
            yield this.buildItem(item, 'timeline', cp, tweet)

            if (includeReposts) {
              yield* this.streamReposts(item, {
                uid,
                cp,
                maxPages,
                onRaw: options.onRaw,
                progressState,
                fetchRepostPage,
                prepareTweet,
              })
            }

            currentLastId = item.mblogid
            cp.lastTimelineMblogId = currentLastId
          }

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

    phase = includeFavorites ? 'favorites' : 'done'
    lastTimelineMblogId = undefined
    cp.phase = phase
    cp.page = undefined
    delete cp.sliceEnd
    delete cp.slicePage
    delete cp.sliceWindow
    cp.lastTimelineMblogId = undefined
    cp.favoritesPage = includeFavorites ? (favoritesPage ?? 1) : undefined
    favoritesPage = cp.favoritesPage

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

      cp.phase = 'done'
    }

    if (cp.phase === 'done')
      await reportProgress({ source: 'done' })
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

  /** 内联某条微博的转发页（P1-2），转发本身不改变 timeline 游标语义。 */
  private async* streamReposts(
    parent: TimelineRawItem,
    context: {
      uid: string
      cp: ArchiveCheckpoint
      maxPages: number
      onRaw?: ArchiveStreamOptions['onRaw']
      progressState: { processed: number }
      fetchRepostPage: (parentMblogId: string, page: number) => Promise<RepostTimelineResponse | undefined>
      prepareTweet: (
        raw: TimelineRawItem,
        source: ArchiveItem['source'],
        page?: number,
        parentMblogId?: string,
      ) => Promise<Tweet>
    },
  ): AsyncIterableIterator<ArchiveItem> {
    const { uid, cp, maxPages, onRaw, progressState, fetchRepostPage, prepareTweet } = context
    let repostPage = 1
    let repostPages = 0
    let previousRepostIds = new Set<string>()

    while (repostPages < maxPages) {
      const reposts = await fetchRepostPage(parent.mblogid, repostPage)
      if (!reposts)
        break // P1-4：转发页失败按策略 skip，继续下一条 timeline item
      const rawReposts = reposts.data || []
      const repostList = uniqueByMblogId(rawReposts)
      const repostIds = repostList.map(repost => repost.mblogid)
      if (repostIds.length === 0)
        break
      if (isRepeatedPage(repostIds, previousRepostIds))
        break

      for (const repost of repostList) {
        await onRaw?.(repost, {
          uid,
          source: 'repost',
          mblogId: repost.mblogid,
          page: repostPage,
          parentMblogId: parent.mblogid,
        })
        const tweet = await prepareTweet(repost, 'repost', repostPage, parent.mblogid)
        progressState.processed += 1
        yield this.buildItem(repost, 'repost', cp, tweet)
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
