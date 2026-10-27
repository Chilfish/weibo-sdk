import type { ArchivedTweet, ArchiveFile, ArchiveIssue } from '~/types/archive/IArchiveFile'
import type { MergeArchiveOptions, MergeArchiveResult } from '~/types/archive/IArchiveMerge'
import type { ITweet, ITweetComment } from '~/types/domain/ITweet'
import { migrateTweetV2toV3 } from '~/models/data/migrateTweet'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { ARCHIVE_SCHEMA_ID, ARCHIVE_SCHEMA_URL } from '~/types/archive/IArchiveFile'
import { dedupeUserArchiveIssues } from './issues'
import { parseArchiveCreatedAt } from './time'

/** 上一版归档格式；读取时把记录迁移到当前契约。 */
const ARCHIVE_SCHEMA_ID_V2 = 'weibo-user-archive/v2'

interface Candidate {
  record: ArchivedTweet
  input: ArchiveFile
  order: number
  issues: number
}

function invalid(message: string, field: string, value?: unknown): InvalidConfigError {
  return new InvalidConfigError(message, { field, ...(value === undefined ? {} : { value }) })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function generatedAtOf(file: ArchiveFile): number {
  const parsed = Date.parse(file.generatedAt ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function uidOf(file: ArchiveFile): string {
  const uid = file.query?.uid ?? file.user?.id
  return uid === undefined || uid === null ? '' : String(uid)
}

/** 归档记录的稳定主键；旧文件可能只在 tweet 上带 id。 */
function recordId(record: ArchivedTweet): string {
  const id = record.mblogId || record.tweet?.mblogId || record.tweet?.id
  return id === undefined ? '' : String(id)
}

function mediaCount(record: ArchivedTweet): number {
  return record.tweet?.media?.length ?? 0
}

function textLength(record: ArchivedTweet): number {
  return record.tweet?.text?.length ?? 0
}

/** 越小越优先：issue 更少 → 媒体更多 → 正文更长 → 归档更新。 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.issues !== b.issues)
    return a.issues - b.issues
  const media = mediaCount(b.record) - mediaCount(a.record)
  if (media !== 0)
    return media
  const text = textLength(b.record) - textLength(a.record)
  if (text !== 0)
    return text
  const generated = generatedAtOf(b.input) - generatedAtOf(a.input)
  return generated !== 0 ? generated : a.order - b.order
}

/** 按 id 并集：保序、重复项递归合并楼中楼。没有 id 的项原样追加。 */
function mergeComments(groups: ITweetComment[][]): ITweetComment[] {
  const order: string[] = []
  const byId = new Map<string, ITweetComment>()
  const idless: ITweetComment[] = []

  for (const group of groups) {
    for (const comment of group) {
      if (!comment.id) {
        idless.push(comment)
        continue
      }
      const current = byId.get(comment.id)
      if (!current) {
        byId.set(comment.id, comment)
        order.push(comment.id)
        continue
      }
      byId.set(comment.id, mergeComment(current, comment))
    }
  }

  return [...order.map(id => byId.get(id)!), ...idless]
}

function mergeReplies(
  a: ITweetComment[] | undefined,
  b: ITweetComment[] | undefined,
): ITweetComment[] | undefined {
  if (!a?.length && !b?.length)
    return undefined
  return mergeComments([a ?? [], b ?? []])
}

function mergeComment(a: ITweetComment, b: ITweetComment): ITweetComment {
  const replies = mergeReplies(a.replies, b.replies)
  const totalReplies = Math.max(a.totalReplies ?? 0, b.totalReplies ?? 0)
  return {
    ...a,
    ...(replies === undefined ? {} : { replies }),
    ...(totalReplies > 0 ? { totalReplies } : {}),
  }
}

function compareReposts(a: ITweet, b: ITweet): number {
  const media = (b.media?.length ?? 0) - (a.media?.length ?? 0)
  return media !== 0 ? media : (b.text?.length ?? 0) - (a.text?.length ?? 0)
}

function mergeReposts(groups: ITweet[][]): ITweet[] {
  const order: string[] = []
  const byId = new Map<string, ITweet>()
  const idless: ITweet[] = []

  for (const group of groups) {
    for (const repost of group) {
      const id = repost.mblogId || repost.id
      if (!id) {
        idless.push(repost)
        continue
      }
      const current = byId.get(id)
      if (!current) {
        byId.set(id, repost)
        order.push(id)
        continue
      }
      if (compareReposts(repost, current) < 0)
        byId.set(id, repost)
    }
  }

  return [...order.map(id => byId.get(id)!), ...idless]
}

function mergeRecord(candidates: Candidate[]): ArchivedTweet {
  const base = [...candidates].sort(compareCandidates)[0]
  const ordered = [base, ...candidates.filter(candidate => candidate !== base)]
  const id = recordId(base.record)

  const comments = mergeComments(ordered.map(candidate => candidate.record.comments ?? []))
  const reposts = ordered
    .map(candidate => candidate.record.reposts)
    .filter((value): value is ITweet[] => value !== undefined)

  return {
    ...base.record,
    mblogId: id,
    source: base.record.source ?? 'timeline',
    tweet: base.record.tweet,
    comments,
    ...(reposts.length === 0 ? {} : { reposts: mergeReposts(reposts) }),
  }
}

/** 同一 mblogId 在别的归档里已经完整拿到时，旧 issue 视为已解决。 */
function isResolvedIssue(issue: ArchiveIssue, files: ArchiveFile[]): boolean {
  if (!issue.mblogId)
    return false

  return files.some((file) => {
    const hasRecord = (file.tweets ?? []).some(entry => recordId(entry) === issue.mblogId)
    if (!hasRecord)
      return false
    if ((issue.stage === 'comments' || issue.stage === 'replies') && file.query?.includeComments === false)
      return false
    if (issue.stage === 'reposts' && file.query?.includeReposts === false)
      return false

    return !(file.errors ?? []).some(other =>
      other.mblogId === issue.mblogId
      && other.stage === issue.stage
      && other.commentId === issue.commentId,
    )
  })
}

type ArchiveRange = ArchiveFile['query']['range']

function mergeRange(files: ArchiveFile[]): ArchiveRange {
  const ranges = files
    .map(file => file.query?.range)
    .filter((range): range is ArchiveRange => isRecord(range) && isRecord(range.since) && isRecord(range.until))

  const first = ranges[0]
  if (!first)
    throw invalid('Cannot merge archives without query.range.', 'range')

  let since = first.since
  let until = first.until
  for (const range of ranges) {
    if (range.since.unix < since.unix)
      since = range.since
    if (range.until.unix > until.unix)
      until = range.until
  }

  return { since: { ...since }, until: { ...until } }
}

function assertArchiveFile(value: unknown, index: number): asserts value is ArchiveFile {
  const label = `Input #${index + 1}`
  if (!isRecord(value) || !Array.isArray(value.tweets)) {
    throw invalid(`${label} is not a weibo-sdk user archive: missing tweets array.`, 'tweets', index)
  }
  if (value.schema !== ARCHIVE_SCHEMA_ID && value.schema !== ARCHIVE_SCHEMA_ID_V2) {
    throw invalid(
      `${label} is not a ${ARCHIVE_SCHEMA_ID} archive (schema: ${JSON.stringify(value.schema)}).`,
      'schema',
      value.schema,
    )
  }

  for (const [itemIndex, entry] of value.tweets.entries()) {
    if (!isRecord(entry) || !isRecord(entry.tweet)) {
      throw invalid(`${label} tweet #${itemIndex + 1} is malformed.`, 'tweets', itemIndex)
    }
    if (!Array.isArray(entry.comments)) {
      throw invalid(`${label} tweet #${itemIndex + 1} is missing comments array.`, 'comments', itemIndex)
    }
  }
}

function migrateTweet(record: ITweet): ITweet {
  return migrateTweetV2toV3(record as unknown as Record<string, unknown>)
}

/** 把 v2 归档记录迁移到当前契约；v3 文件原样返回。 */
function upgradeArchiveFile(file: ArchiveFile): ArchiveFile {
  if (file.schema !== ARCHIVE_SCHEMA_ID_V2)
    return file

  return {
    ...file,
    $schema: ARCHIVE_SCHEMA_URL,
    schema: ARCHIVE_SCHEMA_ID,
    tweets: file.tweets.map(record => ({
      ...record,
      tweet: migrateTweet(record.tweet),
      ...(record.reposts === undefined ? {} : { reposts: record.reposts.map(migrateTweet) }),
    })),
  }
}

/**
 * 合并多份 `weibo-user-archive/v3` 归档（纯函数，不读写文件）。
 *
 * - 按 `mblogId` 合并：微博本体取信息更全的一份，评论 / 楼中楼 / 转发按 id 并集；
 * - 只允许同一 uid；`query.range` 取覆盖包络，内容开关取交集；
 * - 结果与输入顺序无关（`generatedAt` 相同时取先出现的），并且幂等；
 * - `weibo-user-archive/v2` 输入按 `migrateTweetV2toV3` 迁移后参与合并，输出恒为 v3。
 */
export function mergeArchiveFiles(
  files: ArchiveFile[],
  options: MergeArchiveOptions = {},
): MergeArchiveResult {
  if (files.length === 0)
    throw invalid('At least one archive is required.', 'archives')

  files.forEach(assertArchiveFile)

  // v2 归档仍是用户已有的磁盘数据，读取时迁移到当前契约
  const archives = files.map(upgradeArchiveFile)

  const uids = new Set(archives.map(uidOf).filter(uid => uid !== ''))
  if (uids.size > 1) {
    throw invalid(`Cannot merge archives from different accounts: ${[...uids].join(', ')}.`, 'uid', [...uids])
  }
  const uid = [...uids][0]
  if (!uid)
    throw invalid('Cannot merge archives without a uid.', 'uid')

  const latest = archives.reduce((current, file) =>
    generatedAtOf(file) >= generatedAtOf(current) ? file : current)
  const user = latest.user ?? archives.find(file => file.user)?.user
  if (!user)
    throw invalid('Cannot merge archives without user information.', 'user')

  const groups = new Map<string, Candidate[]>()
  let inputTweets = 0

  archives.forEach((file, order) => {
    const issueCounts = new Map<string, number>()
    for (const issue of file.errors ?? []) {
      if (issue.mblogId)
        issueCounts.set(issue.mblogId, (issueCounts.get(issue.mblogId) ?? 0) + 1)
    }

    for (const record of file.tweets) {
      const id = recordId(record)
      if (!id)
        throw invalid(`Input #${order + 1} contains a record without mblogId.`, 'mblogId')
      inputTweets += 1
      const candidate: Candidate = {
        record,
        input: file,
        order,
        issues: issueCounts.get(id) ?? 0,
      }
      const group = groups.get(id)
      if (group)
        group.push(candidate)
      else
        groups.set(id, [candidate])
    }
  })

  const tweets = [...groups.entries()]
    .map(([id, candidates]) => ({ id, record: mergeRecord(candidates) }))
    .sort((a, b) => {
      const timeA = parseArchiveCreatedAt(a.record.tweet?.createdAt ?? '') ?? 0
      const timeB = parseArchiveCreatedAt(b.record.tweet?.createdAt ?? '') ?? 0
      return timeB - timeA || a.id.localeCompare(b.id)
    })
    .map(item => item.record)

  const errors = dedupeUserArchiveIssues(archives.flatMap(file => file.errors ?? []))
    .filter(issue => !isResolvedIssue(issue, archives))
  const complete = errors.length === 0

  const file: ArchiveFile = {
    $schema: ARCHIVE_SCHEMA_URL,
    schema: ARCHIVE_SCHEMA_ID,
    generatedAt: (options.now ?? new Date()).toISOString(),
    complete,
    query: {
      uid,
      range: mergeRange(archives),
      includeComments: archives.every(item => item.query?.includeComments !== false),
      includeReplies: archives.every(item => item.query?.includeReplies !== false),
      includeReposts: archives.every(item => item.query?.includeReposts !== false),
      commentOrder: latest.query?.commentOrder === 'hot' ? 'hot' : 'time',
    },
    user,
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

  return {
    file,
    inputs: files.length,
    inputTweets,
    tweets: tweets.length,
    deduped: inputTweets - tweets.length,
  }
}
