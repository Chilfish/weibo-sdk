import type { ArchiveFile, ArchiveIssue } from '../../src/types/archive/IArchiveFile'
import type { IUser } from '../../src/types/domain/IUser'
import type { JournalTweetEntry, RunConfig } from './types'
import { ARCHIVE_SCHEMA_ID, ARCHIVE_SCHEMA_URL } from '../../src/types/archive/IArchiveFile'
import { dedupeIssues, toIssue } from './issues'
import { dedupeJournalTweets, stripRaw } from './journal'
import { parseCreatedAt } from './time'

export interface AssembleArchiveInput {
  uid: string
  config: RunConfig
  user: IUser
  /** 所有切片的 tweet 记录；内部按 mblogId 去重。 */
  entries: JournalTweetEntry[]
  /** 枚举阶段产生的 issue。 */
  issues: ArchiveIssue[]
  fatalError?: unknown
}

export interface AssembledArchive {
  output: ArchiveFile
  errors: ArchiveIssue[]
  complete: boolean
}

/** 把各切片记录合并成最终归档：去重、按发布时间倒序、统计计数。 */
export function assembleArchive(input: AssembleArchiveInput): AssembledArchive {
  const best = dedupeJournalTweets(input.entries)
  const tweets = best.map(entry => stripRaw(entry.record))
  const errors = dedupeIssues([
    ...input.issues,
    ...(input.fatalError === undefined ? [] : [toIssue('timeline', input.fatalError)]),
    ...best.flatMap(entry => entry.issues),
  ])
  const complete = input.fatalError === undefined && errors.length === 0

  tweets.sort((a, b) => (parseCreatedAt(b.tweet.createdAt) ?? 0) - (parseCreatedAt(a.tweet.createdAt) ?? 0))

  const output: ArchiveFile = {
    $schema: ARCHIVE_SCHEMA_URL,
    schema: ARCHIVE_SCHEMA_ID,
    generatedAt: new Date().toISOString(),
    complete,
    query: {
      uid: input.uid,
      range: {
        since: { ...input.config.range.since, iso: new Date(input.config.range.since.unix * 1000).toISOString() },
        until: { ...input.config.range.until, iso: new Date(input.config.range.until.unix * 1000).toISOString() },
      },
      includeComments: input.config.options.includeComments,
      includeReplies: input.config.options.includeReplies,
      includeReposts: input.config.options.includeReposts,
      commentOrder: input.config.options.commentOrder,
    },
    user: input.user,
    stats: {
      tweets: tweets.length,
      comments: tweets.reduce((sum, tweet) => sum + tweet.comments.length, 0),
      replies: tweets.reduce(
        (sum, tweet) => sum + tweet.comments.reduce((inner, comment) => inner + (comment.replies?.length ?? 0), 0),
        0,
      ),
      errors: errors.length,
    },
    tweets,
    errors,
  }

  return { output, errors, complete }
}
