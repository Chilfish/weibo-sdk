import type { ArchivedTweet, ArchiveIssue } from '~/types/archive/IArchiveFile'
import type {
  UserArchiveRecord,
  UserArchiveRecordCursor,
  UserArchiveStore,
} from '~/types/archive/IUserArchive'
import { parseArchiveCreatedAt } from './time'

export const DEFAULT_USER_ARCHIVE_RECORD_PAGE_LIMIT = 200
const MIN_PAGE_LIMIT = 100
const MAX_PAGE_LIMIT = 500

/** 把调用方给的页大小钳制到 100–500，缺省 200。 */
export function clampUserArchiveRecordPageLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit))
    return DEFAULT_USER_ARCHIVE_RECORD_PAGE_LIMIT
  return Math.min(MAX_PAGE_LIMIT, Math.max(MIN_PAGE_LIMIT, Math.trunc(limit)))
}

/** 分页顺序：`createdAt` 倒序，同一时间再按 `mblogId` 倒序。 */
export function compareUserArchiveRecordOrder(a: UserArchiveRecordCursor, b: UserArchiveRecordCursor): number {
  const left = parseArchiveCreatedAt(a.createdAt) ?? 0
  const right = parseArchiveCreatedAt(b.createdAt) ?? 0
  if (left !== right)
    return right - left
  if (a.mblogId === b.mblogId)
    return 0
  return a.mblogId < b.mblogId ? 1 : -1
}

export function userArchiveRecordCursor(entry: UserArchiveRecord): UserArchiveRecordCursor {
  return { createdAt: entry.record.tweet.createdAt, mblogId: entry.mblogId }
}

export interface UserArchiveRecordIteration {
  /** 页大小；最终由 `clampUserArchiveRecordPageLimit` 钳制。 */
  limit?: number
}

/**
 * 逐页遍历 store 里的记录，内存只跟一页有关。
 *
 * - `store` 实现了 `loadRecordsPage`：按游标翻页；
 * - 没实现：回退到 `loadRecords()` 整表读取（旧行为，仅作兼容）。
 *
 * 页面为空、`hasMore` 为 `false` 或游标没有前进时停止，实现有问题也不会死循环。
 */
export async function* iterateUserArchiveRecords(
  store: UserArchiveStore,
  options: UserArchiveRecordIteration = {},
): AsyncGenerator<UserArchiveRecord> {
  const limit = clampUserArchiveRecordPageLimit(options.limit)

  if (store.loadRecordsPage) {
    let cursor: UserArchiveRecordCursor | undefined
    for (;;) {
      const page = await store.loadRecordsPage({
        ...(cursor === undefined ? {} : { cursor }),
        limit,
      })

      for (const entry of page.records)
        yield entry

      const last = page.records.at(-1)
      if (!page.hasMore || last === undefined)
        return

      const next = userArchiveRecordCursor(last)
      if (cursor !== undefined && compareUserArchiveRecordOrder(next, cursor) === 0)
        return
      cursor = next
    }
  }

  const records = await store.loadRecords()
  for (let index = 0; index < records.length; index += 1)
    yield records[index]
}

/** 归档记录里楼的条数（一级评论下的 `replies` 之和）。 */
function countUserArchiveReplies(record: ArchivedTweet): number {
  return record.comments.reduce((sum, comment) => sum + (comment.replies?.length ?? 0), 0)
}

interface IndexedRecord {
  issues: ArchiveIssue[]
  comments: number
  replies: number
}

/**
 * 记录集合的轻量聚合：只保留去重后的计数和需要重试的记录，不保留正文。
 *
 * 去重规则与 `dedupeUserArchiveRecords` 一致：issue 更少的胜出，相同则保留更晚写入的。
 * 续跑时整库可能有十万条记录，正文全部读进内存就是本次要解决的问题，因此这里只留统计值。
 */
export interface UserArchiveRecordIndex {
  /** 已完整补齐（无 issue）的 mblogId。 */
  readonly completed: Set<string>
  /** 需要重试的记录正文；重试成功后从这里移除。 */
  readonly retryTargets: Map<string, UserArchiveRecord>
  add: (entry: UserArchiveRecord) => void
  stats: () => { tweets: number, comments: number, replies: number }
  /** 去重后各记录遗留的 issue。 */
  issues: () => ArchiveIssue[]
}

export function createUserArchiveRecordIndex(): UserArchiveRecordIndex {
  const best = new Map<string, IndexedRecord>()
  const completed = new Set<string>()
  const retryTargets = new Map<string, UserArchiveRecord>()

  return {
    completed,
    retryTargets,
    add(entry) {
      const current = best.get(entry.mblogId)
      if (current !== undefined && entry.issues.length > current.issues.length)
        return

      best.set(entry.mblogId, {
        issues: entry.issues,
        comments: entry.record.comments.length,
        replies: countUserArchiveReplies(entry.record),
      })

      if (entry.issues.length === 0) {
        completed.add(entry.mblogId)
        retryTargets.delete(entry.mblogId)
        return
      }
      completed.delete(entry.mblogId)
      retryTargets.set(entry.mblogId, entry)
    },
    stats() {
      let comments = 0
      let replies = 0
      for (const entry of best.values()) {
        comments += entry.comments
        replies += entry.replies
      }
      return { tweets: best.size, comments, replies }
    },
    issues() {
      const issues: ArchiveIssue[] = []
      for (const entry of best.values())
        issues.push(...entry.issues)
      return issues
    },
  }
}

/** 按页读完整库并聚合；不保留正文。 */
export async function loadUserArchiveRecordIndex(
  store: UserArchiveStore,
  options: UserArchiveRecordIteration = {},
): Promise<UserArchiveRecordIndex> {
  const index = createUserArchiveRecordIndex()
  for await (const entry of iterateUserArchiveRecords(store, options))
    index.add(entry)
  return index
}
