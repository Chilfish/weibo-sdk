import type { ArchiveIssue } from '~/types/archive/IArchiveFile'
import type {
  UserArchiveMeta,
  UserArchiveRecord,
  UserArchiveSliceState,
  UserArchiveStore,
} from '~/types/archive/IUserArchive'

/** 内存实现：一次运行 / 测试用；不跨进程持久化。 */
export function createMemoryUserArchiveStore(): UserArchiveStore {
  let meta: UserArchiveMeta | undefined
  const slices = new Map<string, UserArchiveSliceState>()
  const records: UserArchiveRecord[] = []
  const issues: ArchiveIssue[] = []

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
    async appendRecord(entry) {
      records.push(entry)
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
      issues.length = 0
    },
  }
}
