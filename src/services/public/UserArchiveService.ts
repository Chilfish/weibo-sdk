import type { ArchiveCheckpoint, ArchiveItem, ArchiveStreamOptions } from '~/services/public/ArchiveService'
import type { TweetCommentsStreamOptions, TweetEnrichResult, TweetRepostsStreamOptions } from '~/services/public/TweetService'
import type { ArchiveIssue } from '~/types/archive/IArchiveFile'
import type {
  UserArchiveEvent,
  UserArchiveMeta,
  UserArchiveOptions,
  UserArchiveProgress,
  UserArchiveRecord,
  UserArchiveResult,
  UserArchiveSlice,
  UserArchiveStore,
  UserArchiveSummary,
} from '~/types/archive/IUserArchive'
import type { ITweet, ITweetComment } from '~/types/domain/ITweet'
import type { IUser } from '~/types/domain/IUser'
import type { WeiboSDKTelemetry } from '~/types/telemetry'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { USER_ARCHIVE_JOURNAL_SCHEMA } from '~/types/archive/IUserArchive'
import { assembleUserArchive, dedupeUserArchiveRecords } from './userArchive/assemble'
import { completeUserArchiveTweet } from './userArchive/complete'
import { applyUserArchiveResumeDefaults, buildUserArchiveConfig, resolveUserArchiveConcurrency, validateUserArchiveResume } from './userArchive/config'
import { dedupeUserArchiveIssues, isFatalUserArchiveError, toUserArchiveIssue } from './userArchive/issues'
import { createMemoryUserArchiveStore } from './userArchive/memoryStore'
import { planUserArchiveSlices } from './userArchive/slices'
import { withinUserArchiveRange } from './userArchive/time'

/** `UserArchiveService` 的依赖（结构化注入，便于离线测试）。 */
export interface UserArchiveServiceDeps {
  streamArchive: (uid: string, options: ArchiveStreamOptions) => AsyncIterableIterator<ArchiveItem>
  enrich: (mblogId: string) => Promise<TweetEnrichResult>
  streamComments: (mblogId: string, options?: TweetCommentsStreamOptions) => AsyncIterable<ITweetComment>
  streamReplies: (mblogId: string, rootCommentId: string, options?: TweetCommentsStreamOptions) => AsyncIterable<ITweetComment>
  streamReposts: (mblogId: string, options?: TweetRepostsStreamOptions) => AsyncIterable<ITweet>
  getUser: (uid: string) => Promise<IUser>
  authMode?: 'cookie' | 'guest'
  telemetry?: WeiboSDKTelemetry
}

interface PendingRecord {
  mblogId: string
  slice: string
  checkpoint?: ArchiveCheckpoint
  task: Promise<{
    tweet: Awaited<ReturnType<typeof completeUserArchiveTweet>>['tweet']
    issues: ArchiveIssue[]
  }>
}

function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: Array<() => void> = []

  const acquire = (): Promise<void> => new Promise<void>((resolve) => {
    if (active < limit) {
      active += 1
      resolve()
      return
    }
    waiting.push(() => {
      active += 1
      resolve()
    })
  })

  const release = (): void => {
    active -= 1
    waiting.shift()?.()
  }

  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire()
    try {
      return await task()
    }
    finally {
      release()
    }
  }
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!shouldStop()) {
      const index = next
      next += 1
      if (index >= items.length)
        return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

function countReplies(entry: UserArchiveRecord): number {
  return entry.record.comments.reduce((sum, comment) => sum + (comment.replies?.length ?? 0), 0)
}

/**
 * 范围 + 深度归档一个用户：按日期切片枚举、逐条补全、可断点续跑。
 *
 * 与 `ArchiveService.streamArchive` 的分工：
 * - `streamArchive` 负责单账号的完整镜像（timeline / likes / favorites / media）；
 * - `UserArchiveService` 负责「指定范围 + 单条深度补全 + 单文件产出」，复用前者的切片枚举能力。
 */
export class UserArchiveService {
  constructor(private readonly deps: UserArchiveServiceDeps) {}

  /**
   * 流式执行一次范围归档。
   *
   * 事件顺序：`meta` → 每个切片 `slice-start` / `record*` / `issue*` / `slice-done` → `done`。
   * 运行期错误会转成 `issue` 事件并继续（致命错误停止后续切片）；配置 / 访客模式错误在首次迭代前抛出。
   */
  async* stream(uid: string, options: UserArchiveOptions = {}): AsyncIterableIterator<UserArchiveEvent> {
    if (this.deps.authMode === 'guest') {
      throw new InvalidConfigError(
        'Guest mode cannot run a full user archive: anonymous m.weibo.cn lists are first-page only. '
        + 'Provide a signed-in cookie for archive, or read individual posts/comments instead.',
        { field: 'userArchive', authMode: 'guest', uid },
      )
    }

    const store = options.store ?? createMemoryUserArchiveStore()
    let meta = await store.loadMeta()
    const config = buildUserArchiveConfig(uid, applyUserArchiveResumeDefaults(options, meta?.config))
    const concurrency = resolveUserArchiveConcurrency(options.concurrency)

    if (meta) {
      validateUserArchiveResume(meta, config)
      meta = await this.refreshMetaUser(meta, store)
    }
    else {
      const user = await this.deps.getUser(uid)
      meta = {
        type: 'meta',
        schema: USER_ARCHIVE_JOURNAL_SCHEMA,
        createdAt: new Date().toISOString(),
        config,
        slices: planUserArchiveSlices(config.range.since.unix, config.range.until.unix, config.sliceDays),
        user,
      }
      await store.saveMeta(meta)
    }

    yield { type: 'meta', meta }

    const runConfig = meta.config
    const slices = meta.slices
    const loadedSlices = await store.loadSlices()
    const sliceStates = new Map(loadedSlices.map(state => [state.slice.key, state]))
    const allRecords = await store.loadRecords()
    const bestBefore = dedupeUserArchiveRecords(allRecords)
    const completed = new Set(bestBefore.filter(entry => entry.issues.length === 0).map(entry => entry.mblogId))
    const retryTargets = new Map(bestBefore.filter(entry => entry.issues.length > 0).map(entry => [entry.mblogId, entry] as const))
    const attempted = new Set<string>()
    const limit = createLimiter(concurrency)
    const traceId = `${Date.now()}-user-archive-${uid}`
    const sliceTotals = new Map(Object.entries(meta.totals ?? {}))
    const sliceIndexByKey = new Map(slices.map(slice => [slice.key, slice.index]))
    const overallTotal = (): number | undefined => {
      if (sliceTotals.size === 0)
        return undefined
      let total = 0
      for (const value of sliceTotals.values())
        total += value
      return total > 0 ? total : undefined
    }
    let fatalError: unknown
    let processed = completed.size

    const report = async (progress: UserArchiveProgress): Promise<void> => {
      const sliceIndex = sliceIndexByKey.get(progress.slice)
      const payload: UserArchiveProgress = {
        ...progress,
        overallTotal: overallTotal(),
        sliceTotal: slices.length,
        ...(sliceIndex === undefined ? {} : { sliceIndex }),
      }
      try {
        await options.onProgress?.(payload)
      }
      catch {
        // 进度回调异常不影响归档。
      }
      try {
        await this.deps.telemetry?.emit({
          event_name: 'user_archive_progress',
          timestamp: Date.now(),
          trace_id: traceId,
          uid,
          slice: payload.slice,
          phase: payload.phase,
          processed: payload.processed,
          source: payload.source,
          page: payload.page,
          total: payload.total,
          remaining: payload.remaining,
          overall_total: payload.overallTotal,
          slice_index: payload.sliceIndex,
          slice_total: payload.sliceTotal,
        })
      }
      catch {
        // telemetry must not break SDK behavior
      }
    }

    const reportIssue = async (issue: ArchiveIssue, slice?: UserArchiveSlice): Promise<void> => {
      try {
        await options.onIssue?.(issue, slice?.key)
      }
      catch {
        // 回调异常不影响归档。
      }
      try {
        await this.deps.telemetry?.emit({
          event_name: 'user_archive_item_error',
          timestamp: Date.now(),
          trace_id: traceId,
          uid,
          slice: slice?.key,
          stage: issue.stage,
          mblogId: issue.mblogId,
          commentId: issue.commentId,
          error_code: issue.code,
          error_level: issue.level === 'transport' || issue.level === 'protocol' || issue.level === 'business' || issue.level === 'storage'
            ? issue.level
            : undefined,
          error_retryable: issue.retryable,
          error_name: issue.code,
          error_message: issue.message,
        })
      }
      catch {
        // telemetry must not break SDK behavior
      }
    }

    const commit = async (pending: PendingRecord): Promise<UserArchiveRecord> => {
      const { tweet, issues } = await pending.task
      const entry: UserArchiveRecord = {
        slice: pending.slice,
        mblogId: pending.mblogId,
        record: tweet,
        issues,
        ...(pending.checkpoint === undefined ? {} : { checkpoint: pending.checkpoint }),
      }
      await store.appendRecord(entry)
      if (issues.length === 0) {
        completed.add(entry.mblogId)
        retryTargets.delete(entry.mblogId)
      }
      processed += 1
      try {
        await options.onRecord?.(entry)
      }
      catch {
        // 落盘回调异常由调用方负责；不改变归档结果。
      }
      await report({ uid, slice: pending.slice, phase: 'complete', processed })
      return entry
    }

    const runCompletion = (tweet: ITweet): PendingRecord['task'] => limit(async () => {
      const result = await completeUserArchiveTweet(
        {
          enrich: this.deps.enrich,
          streamComments: this.deps.streamComments,
          streamReplies: this.deps.streamReplies,
          streamReposts: this.deps.streamReposts,
        },
        tweet,
        runConfig.options,
      )
      return { tweet: result.tweet, issues: result.issues }
    })

    for (const slice of slices) {
      if (fatalError !== undefined || options.signal?.aborted)
        break

      const state = sliceStates.get(slice.key)
      if (state?.done) {
        yield { type: 'slice-start', slice, resumed: true }
        await report({ uid, slice: slice.key, phase: 'slice-done', processed })
        yield { type: 'slice-done', slice: slice.key }
        continue
      }

      yield { type: 'slice-start', slice, resumed: state?.checkpoint !== undefined }
      await report({ uid, slice: slice.key, phase: 'enumerate', processed })

      const sliceIssues: ArchiveIssue[] = []
      const pending: PendingRecord[] = []

      try {
        for await (const item of this.deps.streamArchive(uid, {
          timelineSource: 'search',
          since: slice.since,
          until: slice.until,
          ...(runConfig.sliceDays <= 0 ? {} : { sliceWindow: slice.until - slice.since + 1 }),
          includeReposts: false,
          includeFavorites: false,
          includeComments: false,
          ...(state?.checkpoint === undefined ? {} : { checkpoint: state.checkpoint }),
          onProgress: async (progress) => {
            if (progress.total !== undefined && sliceTotals.get(slice.key) !== progress.total) {
              sliceTotals.set(slice.key, progress.total)
              meta.totals = Object.fromEntries(sliceTotals)
              try {
                await store.saveMeta(meta)
              }
              catch {
                // 进度总数只是展示/校验用，写 meta 失败不阻断归档。
              }
            }
            await report({
              uid,
              slice: slice.key,
              phase: 'enumerate',
              processed,
              source: progress.source,
              page: progress.page,
              total: progress.total,
              remaining: progress.remaining,
            })
          },
          onItemError: (error, context) => {
            const stage = context.stage === 'comments'
              ? 'comments'
              : context.stage === 'reposts' ? 'reposts' : 'timeline'
            sliceIssues.push(toUserArchiveIssue(stage, error, {
              mblogId: context.mblogId ?? context.parentMblogId,
            }))
            // 枚举阶段失败默认中止当前切片，避免把缺页当成完整归档。
            return undefined
          },
        })) {
          if (options.signal?.aborted)
            break
          if (item.source !== 'timeline' || !item.tweet || !item.mblogId)
            continue

          const tweet = item.tweet
          // 已完整处理过：只推进 checkpoint，不重复请求。
          if (completed.has(item.mblogId)) {
            if (item.checkpoint !== undefined)
              await store.saveCheckpoint(slice, item.checkpoint)
            continue
          }
          if (attempted.has(item.mblogId))
            continue
          if (!withinUserArchiveRange(tweet, runConfig.range.since.unix, runConfig.range.until.unix)) {
            if (item.checkpoint !== undefined)
              await store.saveCheckpoint(slice, item.checkpoint)
            continue
          }

          attempted.add(item.mblogId)
          pending.push({
            mblogId: item.mblogId,
            slice: slice.key,
            ...(item.checkpoint === undefined ? {} : { checkpoint: item.checkpoint }),
            task: runCompletion(tweet),
          })

          // 窗口满了就先落盘最早发起的一条，保证 journal / checkpoint 顺序与串行时一致。
          if (pending.length >= concurrency) {
            const entry = await commit(pending.shift()!)
            yield { type: 'record', entry }
          }
        }
      }
      catch (error) {
        if (isFatalUserArchiveError(error))
          fatalError ??= error
        sliceIssues.push(toUserArchiveIssue('timeline', error))
      }
      finally {
        // 枚举中止 / 提前退出时，窗口内已发出的补全仍要收尾落盘。
        while (pending.length > 0) {
          try {
            const entry = await commit(pending.shift()!)
            yield { type: 'record', entry }
          }
          catch (error) {
            fatalError ??= error
            sliceIssues.push(toUserArchiveIssue('detail', error))
          }
        }
      }

      for (const issue of sliceIssues) {
        await store.appendIssue(issue, slice)
        await reportIssue(issue, slice)
        yield { type: 'issue', slice: slice.key, issue }
      }

      if (fatalError === undefined) {
        await store.markSliceDone(slice)
        await report({ uid, slice: slice.key, phase: 'slice-done', processed })
        yield { type: 'slice-done', slice: slice.key }
      }
      else {
        break
      }
    }

    // 断点之前已经失败过的微博：本次枚举不一定会再遇到，补一轮重试。
    const retryEntries: UserArchiveRecord[] = []
    if (fatalError === undefined && !options.signal?.aborted) {
      const retries = [...retryTargets.values()].filter(entry => !attempted.has(entry.mblogId))
      await runPool(retries, concurrency, async (entry) => {
        if (attempted.has(entry.mblogId))
          return
        attempted.add(entry.mblogId)
        const { tweet, issues } = await runCompletion(entry.record.tweet)
        const line: UserArchiveRecord = {
          slice: entry.slice,
          mblogId: entry.mblogId,
          record: tweet,
          issues,
        }
        await store.appendRecord(line)
        processed += 1
        try {
          await options.onRecord?.(line)
        }
        catch {
          // 落盘回调异常由调用方负责；不改变归档结果。
        }
        if (issues.length === 0) {
          completed.add(entry.mblogId)
          retryTargets.delete(entry.mblogId)
        }
        retryEntries.push(line)
      }, () => fatalError !== undefined)
    }
    for (const entry of retryEntries)
      yield { type: 'record', entry }

    const finalRecords = await store.loadRecords()
    const finalIssues = await store.loadIssues()
    const best = dedupeUserArchiveRecords(finalRecords)
    const aborted = options.signal?.aborted === true
    const allIssues = dedupeUserArchiveIssues([
      ...finalIssues,
      ...(aborted ? [{ stage: 'timeline' as const, code: 'ABORTED', message: 'Archive aborted by signal.' }] : []),
      ...(fatalError === undefined ? [] : [toUserArchiveIssue('timeline', fatalError)]),
      ...best.flatMap(entry => entry.issues),
    ])
    const complete = !aborted && fatalError === undefined && allIssues.length === 0
    const estimatedTotal = overallTotal()
    const coverage = estimatedTotal === undefined
      ? undefined
      : Math.min(1, best.length / estimatedTotal)
    const summary: UserArchiveSummary = {
      uid,
      tweets: best.length,
      comments: best.reduce((sum, entry) => sum + entry.record.comments.length, 0),
      replies: best.reduce((sum, entry) => sum + countReplies(entry), 0),
      errors: allIssues.length,
      complete,
      ...(estimatedTotal === undefined ? {} : { estimatedTotal }),
      ...(coverage === undefined ? {} : { coverage }),
    }
    yield { type: 'done', summary }
  }

  /**
   * 执行一次范围归档并返回完整 `ArchiveFile`。
   *
   * 与 `stream()` 一样，运行期失败进入 `file.errors` 并返回 `complete: false`；
   * 只有配置错误 / 访客模式在开始前抛出。
   */
  async run(uid: string, options: UserArchiveOptions = {}): Promise<UserArchiveResult> {
    const store = options.store ?? createMemoryUserArchiveStore()
    let meta: UserArchiveMeta | undefined
    for await (const event of this.stream(uid, { ...options, store })) {
      if (event.type === 'meta')
        meta = event.meta
    }
    if (!meta)
      throw new InvalidConfigError('User archive did not produce a meta record.', { field: 'userArchive', uid })

    const records = await store.loadRecords()
    const issues = await store.loadIssues()
    const { file, complete, summary } = assembleUserArchive({
      meta,
      records,
      issues,
      ...(options.signal?.aborted ? { aborted: true } : {}),
    })
    return { file, complete, summary, user: meta.user }
  }

  /** 续跑时刷新用户信息；失败则沿用 journal 里的快照。 */
  private async refreshMetaUser(meta: UserArchiveMeta, store: UserArchiveStore): Promise<UserArchiveMeta> {
    try {
      const user = await this.deps.getUser(meta.config.uid)
      const next: UserArchiveMeta = { ...meta, user }
      await store.saveMeta(next)
      return next
    }
    catch {
      return meta
    }
  }
}

export type {
  UserArchiveContentOptions,
  UserArchiveEvent,
  UserArchiveMeta,
  UserArchiveOptions,
  UserArchiveProgress,
  UserArchiveRecord,
  UserArchiveResult,
  UserArchiveRunConfig,
  UserArchiveSlice,
  UserArchiveSliceState,
  UserArchiveStore,
  UserArchiveSummary,
} from '~/types/archive/IUserArchive'
