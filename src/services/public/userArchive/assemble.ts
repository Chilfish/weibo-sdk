import type {
  ArchivedTweet,
  ArchiveFile,
  ArchiveIssue,
} from '~/types/archive/IArchiveFile'
import type {
  UserArchiveMeta,
  UserArchiveRecord,
  UserArchiveSummary,
} from '~/types/archive/IUserArchive'
import { ARCHIVE_SCHEMA_ID, ARCHIVE_SCHEMA_URL } from '~/types/archive/IArchiveFile'
import { dedupeUserArchiveIssues, toUserArchiveIssue } from './issues'
import { parseArchiveCreatedAt } from './time'

/** 旧 journal 可能带 raw；归档 JSON 不再包含 raw，合并时统一剥掉。 */
export function stripUserArchiveRaw(record: ArchivedTweet): ArchivedTweet {
  if (!('raw' in record))
    return record
  const copy = { ...record }
  delete (copy as { raw?: unknown }).raw
  return copy
}

/** 同一个 mblogId 出现多次时，优先保留 issues 更少的一条；相同则保留更晚写入的。 */
export function dedupeUserArchiveRecords(records: UserArchiveRecord[]): UserArchiveRecord[] {
  const byId = new Map<string, UserArchiveRecord>()
  for (const entry of records) {
    const current = byId.get(entry.mblogId)
    if (!current || entry.issues.length <= current.issues.length)
      byId.set(entry.mblogId, entry)
  }
  return [...byId.values()]
}

export interface UserArchiveAssemblyInput {
  meta: UserArchiveMeta
  records: UserArchiveRecord[]
  /** 枚举阶段产生的 issue（不含记录内部的 issue）。 */
  issues: ArchiveIssue[]
  fatalError?: unknown
  /** 调用方通过 AbortSignal 主动中止。 */
  aborted?: boolean
}

export interface UserArchiveAssembly {
  file: ArchiveFile
  summary: UserArchiveSummary
  complete: boolean
  errors: ArchiveIssue[]
}

/** 把各切片记录合并成最终归档：去重、排序、统计。 */
export function assembleUserArchive(input: UserArchiveAssemblyInput): UserArchiveAssembly {
  const best = dedupeUserArchiveRecords(input.records)
  const tweets = best.map(entry => stripUserArchiveRaw(entry.record))
  const errors = dedupeUserArchiveIssues([
    ...input.issues,
    ...(input.aborted ? [{ stage: 'timeline' as const, code: 'ABORTED', message: 'Archive aborted by signal.' }] : []),
    ...(input.fatalError === undefined ? [] : [toUserArchiveIssue('timeline', input.fatalError)]),
    ...best.flatMap(entry => entry.issues),
  ])
  const complete = !input.aborted && input.fatalError === undefined && errors.length === 0

  tweets.sort((a, b) => (parseArchiveCreatedAt(b.tweet.createdAt) ?? 0) - (parseArchiveCreatedAt(a.tweet.createdAt) ?? 0))

  const { config } = input.meta
  const summary: UserArchiveSummary = {
    uid: config.uid,
    tweets: tweets.length,
    comments: tweets.reduce((sum, tweet) => sum + tweet.comments.length, 0),
    replies: tweets.reduce(
      (sum, tweet) => sum + tweet.comments.reduce((inner, comment) => inner + (comment.replies?.length ?? 0), 0),
      0,
    ),
    errors: errors.length,
    complete,
  }

  const file: ArchiveFile = {
    $schema: ARCHIVE_SCHEMA_URL,
    schema: ARCHIVE_SCHEMA_ID,
    generatedAt: new Date().toISOString(),
    complete,
    query: {
      uid: config.uid,
      range: {
        since: { ...config.range.since, iso: new Date(config.range.since.unix * 1000).toISOString() },
        until: { ...config.range.until, iso: new Date(config.range.until.unix * 1000).toISOString() },
      },
      includeComments: config.options.includeComments,
      includeReplies: config.options.includeReplies,
      includeReposts: config.options.includeReposts,
      commentOrder: config.options.commentOrder,
    },
    user: input.meta.user,
    stats: {
      tweets: summary.tweets,
      comments: summary.comments,
      replies: summary.replies,
      errors: summary.errors,
    },
    tweets,
    errors,
  }

  return { file, summary, complete, errors }
}
