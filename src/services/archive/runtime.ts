import type { MyCommentsResponse } from '../endpoints/commentHistory'
import type { LikeListResponse } from '../endpoints/like'
import type { ImageWallResponse, WaterfallResponse } from '../endpoints/media'
import type { BuildCommentsResponse, RepostTimelineResponse } from '../endpoints/tweet'
import type {
  ArchiveCheckpoint,
  ArchiveErrorAction,
  ArchiveItem,
  ArchiveItemErrorContext,
  ArchivePhase,
  ArchiveProgress,
  ArchiveServiceDeps,
  ArchiveStreamOptions,
} from '../public/ArchiveService'
import type { ArchiveRunState } from './checkpoint'
import type { TimelineRawItem } from './utils'
import type { ITweetComment } from '~/types/domain/ITweet'
import type { IUserMediaAsset } from '~/types/domain/IUserMediaAsset'
import { normalizeComment, Tweet } from '~/models/data/Tweet'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { TWEET_CONTRACT_VERSION } from '~/types/domain/ITweet'
import { stripVolatileKeys } from '~/utils/structure'
import { resolveTimeInput } from '~/utils/timeInput'
import { applyPhaseCheckpoint, createCheckpoint } from './checkpoint'
import {
  DEFAULT_MAX_SLICE_ITEMS,
  isOriginalRaw,
  isPinnedRaw,
  isRetryableError,
  parseCreatedAt,
  resolveConcurrency,
  sleep,
  toErrorTelemetryFields,
  WEIBO_EPOCH_SECONDS,
} from './utils'

/** 单条 timeline 项的预取任务（评论链 + 转发首页）。 */
export interface PreparedTimelineItem {
  comments: Promise<ITweetComment[]>
  firstRepostPage?: Promise<RepostTimelineResponse | undefined>
}

type ErrorContextInput = Omit<ArchiveItemErrorContext, 'uid' | 'phase'>

export type LikesDep = (uid: string, page?: number) => Promise<LikeListResponse>
export type CommentHistoryDep = (options: { maxId?: number, page?: number }) => Promise<MyCommentsResponse>
export type ImagePageDep = (uid: string, options?: { sinceId?: string | number }) => Promise<ImageWallResponse>
export type VideoPageDep = (uid: string, options?: { cursor?: string | number }) => Promise<WaterfallResponse>
export type SearchByDateDep = NonNullable<ArchiveServiceDeps['tweets']['fetchRawSearchByDate']>

/**
 * 归档运行期上下文。
 *
 * 每个阶段（timeline / likes / …）只依赖这一个对象：它持有依赖、选项、checkpoint
 * 与共享的进度/错误策略，阶段函数本身不再触碰 ArchiveService 的私有状态。
 */
export class ArchiveRuntime {
  readonly cp: ArchiveCheckpoint
  readonly progress = { processed: 0 }
  readonly traceId: string

  readonly maxPages: number
  readonly count: number
  readonly concurrency: number
  readonly maxRetries: number
  readonly retryDelayMs: number
  readonly includeReposts: boolean
  readonly includeFavorites: boolean
  readonly includeLikes: boolean
  readonly includeCommentHistory: boolean
  readonly includeImages: boolean
  readonly includeVideos: boolean
  readonly includeComments: boolean
  readonly originalOnly: boolean
  readonly timelineSource: 'mymblog' | 'search'
  readonly includeDateSlices: boolean
  readonly since: number
  readonly maxSliceItems: number

  readonly searchByDate?: SearchByDateDep
  private readonly commentsDep?: ArchiveServiceDeps['tweets']['fetchRawComments']
  private readonly likesDep?: LikesDep
  private readonly commentHistoryDep?: CommentHistoryDep
  private readonly imagePageDep?: ImagePageDep
  private readonly videoPageDep?: VideoPageDep

  private readonly incrementalSince?: number
  private readonly stopAtMblogId?: string
  private readonly skipPinned: boolean
  readonly repostErrorPolicy: ArchiveErrorAction
  readonly commentsErrorPolicy: ArchiveErrorAction
  readonly likesErrorPolicy: ArchiveErrorAction
  readonly commentHistoryErrorPolicy: ArchiveErrorAction
  readonly imagesErrorPolicy: ArchiveErrorAction
  readonly videosErrorPolicy: ArchiveErrorAction

  constructor(
    readonly uid: string,
    readonly deps: ArchiveServiceDeps,
    readonly options: ArchiveStreamOptions,
    readonly state: ArchiveRunState,
  ) {
    this.originalOnly = options.originalOnly ?? false
    this.includeReposts = (options.includeReposts ?? true) && !this.originalOnly
    this.includeFavorites = options.includeFavorites ?? true
    this.includeLikes = options.includeLikes ?? false
    this.includeCommentHistory = options.includeCommentHistory ?? false
    this.includeImages = options.includeImages ?? false
    this.includeVideos = options.includeVideos ?? false
    this.includeComments = options.includeComments ?? false
    this.maxPages = options.maxPagesPerPhase ?? Number.POSITIVE_INFINITY
    this.count = options.count ?? 20
    this.concurrency = resolveConcurrency(options.concurrency)
    this.timelineSource = options.timelineSource ?? 'mymblog'
    this.includeDateSlices = options.includeDateSlices ?? true
    this.since = options.since ?? WEIBO_EPOCH_SECONDS
    this.maxSliceItems = options.maxSliceItems ?? DEFAULT_MAX_SLICE_ITEMS
    this.maxRetries = options.maxRetries ?? 1
    this.retryDelayMs = options.retryDelayMs ?? 0
    this.repostErrorPolicy = options.repostErrorPolicy ?? 'skip'
    this.commentsErrorPolicy = options.commentsErrorPolicy ?? 'skip'
    this.likesErrorPolicy = options.likesErrorPolicy ?? 'abort'
    this.commentHistoryErrorPolicy = options.commentHistoryErrorPolicy ?? 'abort'
    this.imagesErrorPolicy = options.imagesErrorPolicy ?? 'abort'
    this.videosErrorPolicy = options.videosErrorPolicy ?? 'abort'
    this.stopAtMblogId = options.incremental?.stopAtMblogId
    this.skipPinned = options.incremental?.skipPinned ?? false
    this.incrementalSince = options.incremental?.since === undefined
      ? undefined
      : resolveTimeInput(options.incremental.since, { boundary: 'start', field: 'incremental.since' })
    this.traceId = `${Date.now()}-archive-${uid}`

    // 解构方法会丢失 this：显式绑定到对应子服务实例。
    this.searchByDate = deps.tweets.fetchRawSearchByDate?.bind(deps.tweets)
    this.commentsDep = deps.tweets.fetchRawComments?.bind(deps.tweets)
    this.likesDep = deps.likes?.fetchRawPage.bind(deps.likes)
    this.commentHistoryDep = deps.commentHistory?.fetchRawPage.bind(deps.commentHistory)
    this.imagePageDep = deps.media?.fetchRawImagePage.bind(deps.media)
    this.videoPageDep = deps.media?.fetchRawVideoPage.bind(deps.media)

    this.assertDependencies()

    this.cp = createCheckpoint(uid, state)
    applyPhaseCheckpoint(this.cp, state)
  }

  /** 依赖与选项不匹配时在首次迭代抛出（顺序与历史行为一致）。 */
  private assertDependencies(): void {
    if (this.timelineSource === 'search' && !this.searchByDate) {
      throw new InvalidConfigError('ArchiveService timelineSource="search" requires deps.tweets.fetchRawSearchByDate.', {
        field: 'tweets.fetchRawSearchByDate',
      })
    }
    if (this.includeComments && !this.commentsDep) {
      throw new InvalidConfigError('ArchiveService includeComments=true requires deps.tweets.fetchRawComments.', {
        field: 'tweets.fetchRawComments',
      })
    }
    if (this.includeLikes && !this.likesDep) {
      throw new InvalidConfigError('ArchiveService includeLikes=true requires deps.likes.fetchRawPage.', {
        field: 'likes.fetchRawPage',
      })
    }
    if (this.includeCommentHistory && !this.commentHistoryDep) {
      throw new InvalidConfigError('ArchiveService includeCommentHistory=true requires deps.commentHistory.fetchRawPage.', {
        field: 'commentHistory.fetchRawPage',
      })
    }
    if (this.includeImages && !this.imagePageDep) {
      throw new InvalidConfigError('ArchiveService includeImages=true requires deps.media.fetchRawImagePage.', {
        field: 'media.fetchRawImagePage',
      })
    }
    if (this.includeVideos && !this.videoPageDep) {
      throw new InvalidConfigError('ArchiveService includeVideos=true requires deps.media.fetchRawVideoPage.', {
        field: 'media.fetchRawVideoPage',
      })
    }
  }

  get likes(): LikesDep | undefined {
    return this.likesDep
  }

  get commentHistory(): CommentHistoryDep | undefined {
    return this.commentHistoryDep
  }

  get images(): ImagePageDep | undefined {
    return this.imagePageDep
  }

  get videos(): VideoPageDep | undefined {
    return this.videoPageDep
  }

  async reportProgress(extra: {
    total?: number
    remaining?: number
    source?: ArchiveProgress['source']
    page?: number
  }): Promise<void> {
    const progress: ArchiveProgress = {
      uid: this.uid,
      phase: this.cp.phase,
      processed: this.progress.processed,
      ...extra,
    }
    try {
      await this.options.onProgress?.(progress)
    }
    catch {
      // 进度回调异常不影响归档。
    }
    try {
      await this.deps.telemetry?.emit({
        event_name: 'archive_progress',
        timestamp: Date.now(),
        trace_id: this.traceId,
        uid: this.uid,
        phase: this.cp.phase,
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

  private async emitItemError(
    error: unknown,
    context: ArchiveItemErrorContext,
    action: ArchiveErrorAction,
  ): Promise<void> {
    try {
      await this.deps.telemetry?.emit({
        event_name: 'archive_item_error',
        timestamp: Date.now(),
        trace_id: this.traceId,
        uid: this.uid,
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

  async runWithPolicy<T>(
    fn: () => Promise<T>,
    context: ErrorContextInput,
    fallback: ArchiveErrorAction,
  ): Promise<T | undefined> {
    let attempt = 0
    while (true) {
      try {
        return await fn()
      }
      catch (error) {
        const fullContext: ArchiveItemErrorContext = { uid: this.uid, phase: this.cp.phase, ...context }
        let requested: ArchiveErrorAction | undefined
        try {
          requested = (await this.options.onItemError?.(error, fullContext)) ?? undefined
        }
        catch {
          // 回调异常不应掩盖原始错误；退回默认策略。
        }
        const action = requested ?? fallback
        const willRetry = action === 'retry' && isRetryableError(error) && attempt < this.maxRetries
        await this.emitItemError(error, fullContext, willRetry ? 'retry' : action)

        if (willRetry) {
          attempt += 1
          if (this.retryDelayMs > 0)
            await sleep(this.retryDelayMs)
          continue
        }

        if (action === 'abort' || (action === 'retry' && fallback === 'abort'))
          throw error
        return undefined
      }
    }
  }

  /** 拉取一条微博的全部评论页（评论只挂到 timeline / repost 项）。 */
  async fetchComments(
    mblogId: string,
    context: Omit<ErrorContextInput, 'stage'> & { page?: number },
  ): Promise<ITweetComment[]> {
    const commentsDep = this.commentsDep
    if (!commentsDep)
      return []

    const out: ITweetComment[] = []
    const seen = new Set<string>()
    let maxId: number | undefined
    let pages = 0
    let collected = 0
    let total: number | undefined
    const maxCommentPages = this.options.maxCommentPagesPerTweet ?? Number.POSITIVE_INFINITY

    while (pages < maxCommentPages) {
      const response: BuildCommentsResponse | undefined = await this.runWithPolicy(
        () => commentsDep(mblogId, {
          count: this.options.commentCount ?? 20,
          maxId,
          uid: this.uid,
        }),
        { ...context, stage: 'comments', mblogId },
        this.commentsErrorPolicy,
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
  async fetchItemComments(
    raw: TimelineRawItem,
    source: ArchiveItem['source'],
    page?: number,
    parentMblogId?: string,
  ): Promise<ITweetComment[]> {
    // 评论只挂到 timeline / repost 项；收藏、点赞、历史评论不额外拉评论。
    if (!this.includeComments || (source !== 'timeline' && source !== 'repost'))
      return []
    return await this.fetchComments(raw.mblogid, {
      source,
      page,
      parentMblogId,
    })
  }

  /** 归一化 + 挂评论（likes / favorites 阶段使用）。 */
  async prepareTweet(
    raw: TimelineRawItem,
    source: ArchiveItem['source'],
    page?: number,
    parentMblogId?: string,
  ): Promise<Tweet> {
    const tweet = new Tweet(raw)
    const comments = await this.fetchItemComments(raw, source, page, parentMblogId)
    if (comments.length > 0)
      tweet.comments = comments
    return tweet
  }

  fetchRepostPage(parentMblogId: string, repostPage: number): Promise<RepostTimelineResponse | undefined> {
    return this.runWithPolicy(
      () => this.deps.tweets.fetchRawReposts(parentMblogId, { page: repostPage }),
      { stage: 'reposts', source: 'repost', parentMblogId, page: repostPage },
      this.repostErrorPolicy,
    )
  }

  /**
   * 启动单条 timeline 项的独立子请求：评论链与转发首页互不依赖，一起发。
   *
   * 预取窗口内的任务可能因早停 / 消费端中断而永远不被 await，先挂空 catch
   * 避免 unhandled rejection；调用方在 `finally` 用 `Promise.allSettled` 收敛。
   */
  startTimelineItem(item: TimelineRawItem, itemPage: number): PreparedTimelineItem {
    const comments = this.fetchItemComments(item, 'timeline', itemPage)
    const firstRepostPage = this.includeReposts ? this.fetchRepostPage(item.mblogid, 1) : undefined
    void comments.catch(() => {})
    void firstRepostPage?.catch(() => {})
    return { comments, firstRepostPage }
  }

  /** 预取窗口任务收敛，避免提前退出时留下浮动 Promise。 */
  async settlePrepared(prepared: Map<number, PreparedTimelineItem>): Promise<void> {
    const pending: Promise<unknown>[] = []
    for (const task of prepared.values()) {
      pending.push(task.comments)
      if (task.firstRepostPage)
        pending.push(task.firstRepostPage)
    }
    await Promise.allSettled(pending)
  }

  /** 增量 / 原创过滤：timeline 阶段逐条判断「产出 / 跳过 / 停止」。 */
  incrementalAction(raw: TimelineRawItem): 'emit' | 'skip' | 'stop' {
    if (this.stopAtMblogId !== undefined && raw.mblogid === this.stopAtMblogId)
      return 'stop'
    const pinned = isPinnedRaw(raw)
    // 置顶微博可能发布时间很早，不参与时间边界判断（否则一上来就被误判为到底）。
    if (this.incrementalSince !== undefined && !pinned) {
      const ts = parseCreatedAt(raw.created_at)
      if (ts !== undefined && ts < this.incrementalSince)
        return 'stop'
    }
    if (pinned && this.skipPinned)
      return 'skip'
    if (this.originalOnly && !isOriginalRaw(raw))
      return 'skip'
    return 'emit'
  }

  /** 构造磁盘条目；checkpoint 使用浅拷贝，避免后续 item 修改已 yield 的快照。 */
  buildItem(
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
  buildMediaItem(
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

  /** 当前阶段：仅供阶段函数读取（写入必须走 `commit`）。 */
  get phase(): ArchivePhase {
    return this.state.phase
  }

  /** 把运行状态同步进对外的 checkpoint。 */
  commit(): void {
    applyPhaseCheckpoint(this.cp, this.state)
  }
}
