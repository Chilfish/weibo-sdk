import type { ArchiveCheckpoint } from '../../src/services/public/ArchiveService'
import type { ArchivedTweet, ArchiveIssue } from '../../src/types/archive/IArchiveFile'
import type { IUser } from '../../src/types/domain/IUser'
import type { JOURNAL_SCHEMA } from './constants'

export interface RunOptions {
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

export interface RunConfig {
  uid: string
  range: {
    since: { input: string, unix: number }
    until: { input: string, unix: number }
  }
  /** 每 n 天拆一个独立枚举子任务；0 = 不拆分。 */
  sliceDays: number
  options: RunOptions
}

export interface SliceDescriptor {
  index: number
  /** journal 中标识切片；由序号与区间组成，同一配置下稳定。 */
  key: string
  since: number
  until: number
}

export interface JournalMeta {
  type: 'meta'
  schema: typeof JOURNAL_SCHEMA
  createdAt: string
  config: RunConfig
  slices: SliceDescriptor[]
  user: IUser
}

export interface JournalTweetEntry {
  type: 'tweet'
  slice: string
  mblogId: string
  record: ArchivedTweet
  issues: ArchiveIssue[]
  checkpoint?: ArchiveCheckpoint
}

export interface JournalCheckpointEntry {
  type: 'checkpoint'
  slice: string
  checkpoint: ArchiveCheckpoint
}

export interface JournalSliceDoneEntry {
  type: 'slice-done'
  slice: string
}

export interface JournalErrorEntry {
  type: 'error'
  slice?: string
  issue: ArchiveIssue
}

export type JournalEntry
  = | JournalMeta
    | JournalTweetEntry
    | JournalCheckpointEntry
    | JournalSliceDoneEntry
    | JournalErrorEntry

/** 切片 journal 里不会出现 meta（meta 单独放 `<out>.slices/meta.json`）。 */
export type SliceJournalEntry = Exclude<JournalEntry, JournalMeta>

export interface JournalPaths {
  outPath: string
  /** 切片进度目录：每个切片一个唯一命名的 journal，最后合并成单个归档 JSON。 */
  partsDir: string
  metaPath: string
  legacyJournalPath: string
  slicePath: (key: string) => string
}

export interface LoadedSliceJournal {
  tweets: JournalTweetEntry[]
  errors: ArchiveIssue[]
  checkpoint?: ArchiveCheckpoint
  done: boolean
  repaired: boolean
}

export interface SliceState {
  descriptor: SliceDescriptor
  path: string
  checkpoint?: ArchiveCheckpoint
  done: boolean
  tweets: JournalTweetEntry[]
}

export interface PendingArchive {
  mblogId: string
  slice: string
  checkpoint?: ArchiveCheckpoint
  task: Promise<{ tweet: ArchivedTweet, issues: ArchiveIssue[], elapsedMs: number }>
}

export interface JournalRunResult {
  /** 按 mblogId 去重后的最终记录。 */
  entries: JournalTweetEntry[]
  /** 枚举阶段产生、尚未并入 records 的 issue。 */
  issues: ArchiveIssue[]
  fatalError?: unknown
}
