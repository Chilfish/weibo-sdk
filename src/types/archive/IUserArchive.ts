import type { ArchiveCheckpoint } from '../../services/public/ArchiveService'
import type { IUser } from '../domain/IUser'
import type { ArchivedTweet, ArchiveFile, ArchiveIssue } from './IArchiveFile'

/** 用户归档任务 journal 的格式标识；与 `scripts/archive-user` 的切片 journal 兼容。 */
export const USER_ARCHIVE_JOURNAL_SCHEMA = 'weibo-user-archive-journal/v2'

/** 一个固定长度的枚举切片。 */
export interface UserArchiveSlice {
  index: number
  /** journal 中标识切片；同一配置下稳定。 */
  key: string
  since: number
  until: number
}

/** 一次运行的内容选项快照（与 journal 中持久化的结构一致）。 */
export interface UserArchiveContentOptions {
  includeComments: boolean
  includeReplies: boolean
  includeReposts: boolean
  commentOrder: 'time' | 'hot'
  maxComments?: number
  maxCommentPages?: number
  maxReplies?: number
  maxReplyPages?: number
  maxReposts?: number
  maxRepostPages?: number
}

/** 一次运行的配置快照；续跑时用于校验参数一致性。 */
export interface UserArchiveRunConfig {
  uid: string
  range: {
    since: { input: string, unix: number }
    until: { input: string, unix: number }
  }
  /** 每 n 天拆一个独立枚举子任务；0 = 不拆分。 */
  sliceDays: number
  options: UserArchiveContentOptions
}

/** 任务级 meta（切片计划与原始配置），续跑与最终组装都依赖它。 */
export interface UserArchiveMeta {
  type: 'meta'
  schema: typeof USER_ARCHIVE_JOURNAL_SCHEMA
  createdAt: string
  config: UserArchiveRunConfig
  slices: UserArchiveSlice[]
  user: IUser
  /**
   * 各切片 `searchProfile` 报告的条数；key 为 slice.key。
   *
   * 多切片时用于展示整体进度和最终覆盖率，可能是不完整/上游估算值。
   */
  totals?: Record<string, number>
}

/** 一条补全后的归档记录（journal / store 的持久化单位）。 */
export interface UserArchiveRecord {
  slice: string
  mblogId: string
  record: ArchivedTweet
  issues: ArchiveIssue[]
  checkpoint?: ArchiveCheckpoint
}

/** 单个切片的续跑状态。 */
export interface UserArchiveSliceState {
  slice: UserArchiveSlice
  done: boolean
  checkpoint?: ArchiveCheckpoint
}

/**
 * 任务状态的持久化端口。
 *
 * SDK 核心不碰文件系统：调用方可以接内存、IndexedDB、SQLite、对象存储等。
 * CLI 提供一个基于 per-slice JSONL 的文件实现。
 */
export interface UserArchiveStore {
  loadMeta: () => Promise<UserArchiveMeta | undefined>
  saveMeta: (meta: UserArchiveMeta) => Promise<void>
  loadSlices: () => Promise<UserArchiveSliceState[]>
  /** 读取某个切片已有的记录；不传 slice 时返回全部。 */
  loadRecords: (slice?: string) => Promise<UserArchiveRecord[]>
  appendRecord: (entry: UserArchiveRecord) => Promise<void>
  saveCheckpoint: (slice: UserArchiveSlice, checkpoint: ArchiveCheckpoint) => Promise<void>
  markSliceDone: (slice: UserArchiveSlice) => Promise<void>
  /** 枚举阶段产生、不属于具体记录的 issue。 */
  appendIssue: (issue: ArchiveIssue, slice?: UserArchiveSlice) => Promise<void>
  loadIssues: () => Promise<ArchiveIssue[]>
  /** 丢弃全部进度（对应 CLI 的 `--fresh`）。 */
  clear: () => Promise<void>
}

/** `sdk.userArchive.stream()` 的选项。 */
export interface UserArchiveOptions {
  /** 时间范围；默认 2009-08-14 ~ 现在。接受 unix 秒 / `YYYY-MM-DD` / `YYYYMMDD`。 */
  since?: string | number
  until?: string | number
  /** 每 n 天一个枚举子任务；0 = 不拆分。默认 30。 */
  sliceDays?: number
  /** 拉取并挂载一级评论（默认 true）。 */
  includeComments?: boolean
  /** 展开楼中楼（默认 true）。 */
  includeReplies?: boolean
  /** 拉取转发列表（默认 false）。 */
  includeReposts?: boolean
  /** 评论排序（默认 time）。 */
  commentOrder?: 'time' | 'hot'
  maxComments?: number
  maxCommentPages?: number
  maxReplies?: number
  maxReplyPages?: number
  maxReposts?: number
  maxRepostPages?: number
  /** 全局补全并发（SDK 默认 6，上限 32；CLI 默认 20）。实际 QPS 仍由令牌桶控制。 */
  concurrency?: number
  /** 持久化端口；缺省使用内存实现。 */
  store?: UserArchiveStore
  onProgress?: (progress: UserArchiveProgress) => void | Promise<void>
  onIssue?: (issue: ArchiveIssue, slice?: string) => void | Promise<void>
  /** 每条记录完成时触发；流式消费可在这里落盘。 */
  onRecord?: (entry: UserArchiveRecord) => void | Promise<void>
  /** 中断信号；窗口内已发出的补全会在收尾阶段落盘后退出。 */
  signal?: AbortSignal
}

/** 归档进度（切片级）。 */
export interface UserArchiveProgress {
  uid: string
  slice: string
  phase: 'enumerate' | 'complete' | 'slice-done'
  /** 已完成的记录数（续跑时包含从 store 读出的旧记录）。 */
  processed: number
  source?: string
  page?: number
  total?: number
  remaining?: number
  /** 已发现切片的总数之和；未知时缺省。 */
  overallTotal?: number
  /** 当前切片序号（0-based）。 */
  sliceIndex?: number
  /** 本次运行的切片总数。 */
  sliceTotal?: number
}

/** `sdk.userArchive.stream()` 产出的事件。 */
export type UserArchiveEvent
  = | { type: 'meta', meta: UserArchiveMeta }
    | { type: 'slice-start', slice: UserArchiveSlice, resumed: boolean }
    | { type: 'record', entry: UserArchiveRecord }
    | { type: 'issue', slice?: string, issue: ArchiveIssue }
    | { type: 'slice-done', slice: string }
    | { type: 'done', summary: UserArchiveSummary }

export interface UserArchiveSummary {
  uid: string
  tweets: number
  comments: number
  replies: number
  errors: number
  complete: boolean
  /** 上游报告的总数（各切片之和）；不可用时缺省。 */
  estimatedTotal?: number
  /** `tweets / estimatedTotal`，范围 0–1；没有总数时缺省。 */
  coverage?: number
}

/** `sdk.userArchive.run()` 的结果。 */
export interface UserArchiveResult {
  /** 合并后的完整归档信封。 */
  file: ArchiveFile
  /** 是否完整结束（无致命错误且无遗留 issue）。 */
  complete: boolean
  summary: UserArchiveSummary
  user: IUser
}
