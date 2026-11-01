import type { ArchiveIssue } from '~/types/archive/IArchiveFile'
import type {
  UserArchiveMeta,
  UserArchiveRecord,
  UserArchiveRecordCursor,
  UserArchiveRecordPageRequest,
  UserArchiveRecordPageResult,
  UserArchiveSliceState,
  UserArchiveStore,
} from '~/types/archive/IUserArchive'
import { dedupeUserArchiveRecords } from './assemble'
import {
  compareUserArchiveRecordOrder,
  DEFAULT_USER_ARCHIVE_RECORD_PAGE_LIMIT,
  userArchiveRecordCursor,
} from './records'

/** 有序视图里第一条「晚于游标」的位置；数组按 `compareUserArchiveRecordOrder` 升序。 */
function findAfter(records: UserArchiveRecord[], cursor: UserArchiveRecordCursor | undefined): number {
  if (cursor === undefined)
    return 0

  let low = 0
  let high = records.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (compareUserArchiveRecordOrder(userArchiveRecordCursor(records[mid]), cursor) <= 0)
      low = mid + 1
    else
      high = mid
  }
  return low
}

/** 内存实现：一次运行 / 测试用；不跨进程持久化。 */
export function createMemoryUserArchiveStore(): UserArchiveStore {
  let meta: UserArchiveMeta | undefined
  const slices = new Map<string, UserArchiveSliceState>()
  const records: UserArchiveRecord[] = []
  const issues: ArchiveIssue[] = []
  // 分页要求 (createdAt, mblogId) 唯一且有稳定顺序；重试会重复写入同一个 mblogId，
  // 这里按去重后的结果建一次有序快照，写入时失效。
  let orderedRecords: UserArchiveRecord[] | undefined

  const ordered = (): UserArchiveRecord[] => {
    if (orderedRecords !== undefined)
      return orderedRecords
    orderedRecords = dedupeUserArchiveRecords(records)
      .slice()
      .sort((a, b) => compareUserArchiveRecordOrder(userArchiveRecordCursor(a), userArchiveRecordCursor(b)))
    return orderedRecords
  }

  const loadRecordsPage = async (request: UserArchiveRecordPageRequest = {}): Promise<UserArchiveRecordPageResult> => {
    const requested = request.limit
    const limit = requested === undefined || !Number.isFinite(requested)
      ? DEFAULT_USER_ARCHIVE_RECORD_PAGE_LIMIT
      : Math.max(1, Math.trunc(requested))
    const pool = request.slice === undefined
      ? ordered()
      : ordered().filter(entry => entry.slice === request.slice)
    const start = findAfter(pool, request.cursor)
    return {
      records: pool.slice(start, start + limit),
      hasMore: start + limit < pool.length,
    }
  }

  return {
    async loadMeta() {
      return meta
    },
    async saveMeta(next) {
      meta = next
    },
    async loadSlices() {
      return [...slices.values()]
    },
    async loadRecords(slice) {
      return slice === undefined ? [...records] : records.filter(entry => entry.slice === slice)
    },
    loadRecordsPage,
    async appendRecord(entry) {
      records.push(entry)
      orderedRecords = undefined
    },
    async saveCheckpoint(slice, checkpoint) {
      const current = slices.get(slice.key)
      slices.set(slice.key, { slice, done: current?.done ?? false, checkpoint })
    },
    async markSliceDone(slice) {
      const current = slices.get(slice.key)
      slices.set(slice.key, {
        slice,
        done: true,
        ...(current?.checkpoint === undefined ? {} : { checkpoint: current.checkpoint }),
      })
    },
    async appendIssue(issue) {
      issues.push(issue)
    },
    async loadIssues() {
      return [...issues]
    },
    async clear() {
      meta = undefined
      slices.clear()
      records.length = 0
      orderedRecords = undefined
      issues.length = 0
    },
  }
}
