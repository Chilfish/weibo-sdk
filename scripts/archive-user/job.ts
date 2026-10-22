import type { ArchiveCheckpoint } from '../../src/services/public/ArchiveService'
import type { ArchivedTweet, ArchiveIssue, ArchiveIssueStage } from '../../src/types/archive/IArchiveFile'
import type { WeiboSDK } from '../../src/WeiboSDK'
import type {
  JournalRunResult,
  JournalTweetEntry,
  PendingArchive,
  RunConfig,
  SliceDescriptor,
  SliceState,
} from './types'
import { archiveOne } from './archive-one'
import { createLimiter, runPool } from './concurrency'
import { isFatalError, toIssue } from './issues'
import { appendJournal, dedupeJournalTweets, readSliceJournal } from './journal'
import { archiveLog, progressLog } from './log'
import { withinRange } from './time'

export interface ArchiveJobOptions {
  sdk: WeiboSDK
  uid: string
  config: RunConfig
  slices: SliceDescriptor[]
  slicePath: (key: string) => string
  concurrency: number
}

/**
 * 一次归档运行的状态机：切片枚举 → 单条补全 → 失败重试。
 *
 * 切片始终串行（searchProfile 的 page>1 复用会话里最近一次 page=1 的窗口），
 * 切片内部的补全按 `concurrency` 并发；journal 按枚举顺序落盘，续跑语义与串行一致。
 */
export class ArchiveJob {
  private readonly sdk: WeiboSDK
  private readonly uid: string
  private readonly config: RunConfig
  private readonly slicePath: (key: string) => string
  private readonly perSliceWindow: number
  private readonly sliceStates: SliceState[]
  private readonly journalTweets: JournalTweetEntry[]
  private readonly completed: Set<string>
  private readonly retryTargets: Map<string, JournalTweetEntry>
  private readonly attempted = new Set<string>()
  private readonly enumIssues: ArchiveIssue[] = []
  private readonly limitArchive: <T>(task: () => Promise<T>) => Promise<T>
  private fatalError: unknown
  private processed = 0

  constructor(options: ArchiveJobOptions) {
    this.sdk = options.sdk
    this.uid = options.uid
    this.config = options.config
    this.slicePath = options.slicePath
    this.perSliceWindow = options.concurrency
    this.limitArchive = createLimiter(options.concurrency)
    this.sliceStates = options.slices.map((descriptor) => {
      const path = options.slicePath(descriptor.key)
      const loaded = readSliceJournal(path)
      return {
        descriptor,
        path,
        checkpoint: loaded.checkpoint,
        done: loaded.done,
        tweets: loaded.tweets,
      }
    })

    this.journalTweets = this.sliceStates.flatMap(state => state.tweets)
    const bestBefore = dedupeJournalTweets(this.journalTweets)
    this.completed = new Set(
      bestBefore.filter(entry => entry.issues.length === 0).map(entry => entry.mblogId),
    )
    this.retryTargets = new Map(
      bestBefore
        .filter(entry => entry.issues.length > 0)
        .map(entry => [entry.mblogId, entry] as const),
    )
  }

  async execute(): Promise<JournalRunResult> {
    await this.runSlices()
    await this.runRetries()
    return {
      entries: this.journalTweets,
      issues: this.enumIssues,
      fatalError: this.fatalError,
    }
  }

  private async runSlices(): Promise<void> {
    // searchProfile 的 page>1 复用会话里最近一次 page=1 的窗口，切片必须逐个枚举。
    for (const state of this.sliceStates) {
      if (this.fatalError !== undefined)
        break
      try {
        await this.runSlice(state)
      }
      catch (error) {
        // 认证 / 配置 / 持续限流继续跑其他切片没有意义，停止枚举。
        if (isFatalError(error)) {
          this.fatalError ??= error
          archiveLog(`slice ${state.descriptor.key} fatal: ${error instanceof Error ? error.message : String(error)}`)
          break
        }
        const issue = toIssue('timeline', error)
        this.enumIssues.push(issue)
        appendJournal(state.path, { type: 'error', slice: state.descriptor.key, issue })
        archiveLog(`slice ${state.descriptor.key} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** 单个切片的独立枚举 + 补全；checkpoint 只在该切片的 journal 记录里推进。 */
  private async runSlice(state: SliceState): Promise<void> {
    const { descriptor } = state
    if (state.done) {
      archiveLog(`slice ${descriptor.key} already done`)
      return
    }

    const persistCheckpoint = (checkpoint: ArchiveCheckpoint | undefined): void => {
      if (!checkpoint || checkpoint.uid !== this.uid)
        return
      state.checkpoint = checkpoint
      appendJournal(state.path, { type: 'checkpoint', slice: descriptor.key, checkpoint })
    }

    archiveLog(
      `slice ${descriptor.key} start since=${new Date(descriptor.since * 1000).toISOString()}`
      + ` until=${new Date(descriptor.until * 1000).toISOString()}`
      + `${state.checkpoint === undefined ? '' : ' resume'}`,
    )

    const pending: PendingArchive[] = []
    try {
      for await (const item of this.sdk.archive.streamArchive(this.uid, {
        timelineSource: 'search',
        since: descriptor.since,
        until: descriptor.until,
        // 固定为切片跨度，避免 SDK 的自适应窗口跨到相邻切片。
        ...(this.config.sliceDays <= 0 ? {} : { sliceWindow: descriptor.until - descriptor.since + 1 }),
        includeReposts: false,
        includeFavorites: false,
        includeComments: false,
        ...(state.checkpoint === undefined ? {} : { checkpoint: state.checkpoint }),
        onProgress: (progress) => {
          archiveLog(
            `slice=${descriptor.key} phase=${progress.phase} source=${progress.source ?? '-'} page=${progress.page ?? '-'} processed=${progress.processed}`,
          )
        },
        onItemError: (error, context) => {
          const stage: ArchiveIssueStage = context.stage === 'comments'
            ? 'comments'
            : context.stage === 'reposts' ? 'reposts' : 'timeline'
          const issue = toIssue(stage, error, {
            mblogId: context.mblogId ?? context.parentMblogId,
          })
          this.enumIssues.push(issue)
          appendJournal(state.path, { type: 'error', slice: descriptor.key, issue })
          archiveLog(
            `slice=${descriptor.key} error stage=${context.stage} source=${context.source} mblogId=${context.mblogId ?? '-'}: ${error instanceof Error ? error.message : String(error)}`,
          )
          // 枚举阶段失败默认中止当前切片，避免把缺页当成完整归档。
          return undefined
        },
      })) {
        if (item.source !== 'timeline' || !item.tweet || !item.mblogId)
          continue

        const tweet = item.tweet
        // 已完整处理过：只推进 checkpoint，不重复请求。
        if (this.completed.has(item.mblogId)) {
          persistCheckpoint(item.checkpoint)
          continue
        }
        if (this.attempted.has(item.mblogId))
          continue
        if (!withinRange(tweet, this.config.range.since.unix, this.config.range.until.unix)) {
          persistCheckpoint(item.checkpoint)
          continue
        }

        this.attempted.add(item.mblogId)
        pending.push({
          mblogId: item.mblogId,
          slice: descriptor.key,
          ...(item.checkpoint === undefined ? {} : { checkpoint: item.checkpoint }),
          task: this.limitArchive(async () => {
            const startedAt = Date.now()
            progressLog(`[start] ${descriptor.key} ${tweet.mblogId}`)
            const result = await archiveOne(this.sdk, tweet, this.config.options)
            return { ...result, elapsedMs: Date.now() - startedAt }
          }),
        })

        // 窗口满了就先落盘最早发起的一条，保证 journal / checkpoint 顺序与串行时一致。
        if (pending.length >= this.perSliceWindow)
          await this.commitPending(pending.shift()!)
      }
    }
    finally {
      // 枚举中止 / 提前退出时，窗口内已发出的补全仍要收尾落盘。
      while (pending.length > 0) {
        try {
          await this.commitPending(pending.shift()!)
        }
        catch (error) {
          this.fatalError ??= error
        }
      }
    }

    if (this.fatalError === undefined) {
      appendJournal(state.path, { type: 'slice-done', slice: descriptor.key })
      state.done = true
      archiveLog(`slice ${descriptor.key} done`)
    }
  }

  /**
   * 按枚举顺序落盘一条补全结果。并发只发生在请求阶段，
   * 同一切片内 journal 追加顺序与 checkpoint 推进顺序保持和串行时一致，续跑语义不变。
   */
  private async commitPending(pending: PendingArchive): Promise<void> {
    const { tweet, issues, elapsedMs } = await pending.task
    const entry: JournalTweetEntry = {
      type: 'tweet',
      slice: pending.slice,
      mblogId: pending.mblogId,
      record: tweet,
      issues,
      ...(pending.checkpoint === undefined ? {} : { checkpoint: pending.checkpoint }),
    }
    this.journalTweets.push(entry)
    appendJournal(this.slicePath(pending.slice), entry)

    if (issues.length === 0) {
      this.completed.add(pending.mblogId)
      this.retryTargets.delete(pending.mblogId)
    }
    this.processed += 1

    const replyCount = countReplies(tweet)
    progressLog(
      `[${this.processed}] ${pending.slice} ${tweet.mblogId} comments=${tweet.comments.length} replies=${replyCount}`
      + ` took=${(elapsedMs / 1000).toFixed(1)}s`
      + `${issues.length === 0 ? '' : ` errors=${issues.length}`}`,
    )
  }

  private async runRetries(): Promise<void> {
    // 断点之前已经失败过的微博：本次枚举不一定会再遇到，补一轮重试。
    const retries = [...this.retryTargets.values()].filter(entry => !this.attempted.has(entry.mblogId))
    await runPool(retries, this.perSliceWindow, async (entry) => {
      if (this.attempted.has(entry.mblogId))
        return
      this.attempted.add(entry.mblogId)
      const { tweet, issues } = await archiveOne(this.sdk, entry.record.tweet, this.config.options)
      const line: JournalTweetEntry = {
        type: 'tweet',
        slice: entry.slice,
        mblogId: entry.mblogId,
        record: tweet,
        issues,
      }
      this.journalTweets.push(line)
      appendJournal(this.slicePath(entry.slice), line)
      if (issues.length === 0) {
        this.completed.add(entry.mblogId)
        this.retryTargets.delete(entry.mblogId)
      }
      progressLog(
        `[retry] ${entry.slice} ${entry.mblogId} comments=${tweet.comments.length} replies=${countReplies(tweet)}`
        + `${issues.length === 0 ? ' OK' : ` errors=${issues.length}`}`,
      )
    }, () => this.fatalError !== undefined)
  }
}

function countReplies(tweet: ArchivedTweet): number {
  return tweet.comments.reduce((sum, comment) => sum + (comment.replies?.length ?? 0), 0)
}
