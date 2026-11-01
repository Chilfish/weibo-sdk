import type {
  UserArchiveRecord,
  UserArchiveRecordPageRequest,
  UserArchiveRecordPageResult,
  UserArchiveStore,
} from '~/types/archive/IUserArchive'
import { makeArchiveComment, makeArchiveTweet } from 'tests/testkit/userArchive'
import { describe, expect, it } from 'vitest'
import { createMemoryUserArchiveStore } from '~/services/public/userArchive/memoryStore'
import {
  clampUserArchiveRecordPageLimit,
  compareUserArchiveRecordOrder,
  createUserArchiveRecordIndex,
  iterateUserArchiveRecords,
  loadUserArchiveRecordIndex,
} from '~/services/public/userArchive/records'

function makeRecord(
  mblogId: string,
  createdAt: string,
  options: { issues?: UserArchiveRecord['issues'], comments?: UserArchiveRecord['record']['comments'], slice?: string } = {},
): UserArchiveRecord {
  return {
    slice: options.slice ?? 's000',
    mblogId,
    record: {
      mblogId,
      source: 'timeline',
      tweet: makeArchiveTweet(mblogId, createdAt),
      comments: options.comments ?? [],
    },
    issues: options.issues ?? [],
  }
}

/** 只有 `loadRecords` 的最小 store；测试自己按需补 `loadRecordsPage`。 */
function createStoreStub(loadRecords: (slice?: string) => Promise<UserArchiveRecord[]> = async () => []): UserArchiveStore {
  return {
    loadMeta: async () => undefined,
    saveMeta: async () => {},
    loadSlices: async () => [],
    loadRecords,
    appendRecord: async () => {},
    saveCheckpoint: async () => {},
    markSliceDone: async () => {},
    appendIssue: async () => {},
    loadIssues: async () => [],
    clear: async () => {},
  }
}

function withPage(
  base: UserArchiveStore,
  loadRecordsPage: (request: UserArchiveRecordPageRequest) => Promise<UserArchiveRecordPageResult>,
): UserArchiveStore {
  return { ...base, loadRecordsPage }
}

async function collect(iterator: AsyncGenerator<UserArchiveRecord>): Promise<string[]> {
  const ids: string[] = []
  for await (const entry of iterator)
    ids.push(entry.mblogId)
  return ids
}

describe('userArchiveRecords', () => {
  it('clampPageLimitKeepsItBetween100And500', () => {
    expect(clampUserArchiveRecordPageLimit()).toBe(200)
    expect(clampUserArchiveRecordPageLimit(Number.NaN)).toBe(200)
    expect(clampUserArchiveRecordPageLimit(1)).toBe(100)
    expect(clampUserArchiveRecordPageLimit(320.7)).toBe(320)
    expect(clampUserArchiveRecordPageLimit(5000)).toBe(500)
  })

  it('compareOrderSortsByCreatedAtThenMblogIdDescending', () => {
    const keys = [
      { createdAt: '2025-01-14T00:00:00.000Z', mblogId: 'C' },
      { createdAt: '2025-01-15T00:00:00.000Z', mblogId: 'A' },
      { createdAt: '2025-01-15T00:00:00.000Z', mblogId: 'B' },
    ]
    expect(keys.slice().sort(compareUserArchiveRecordOrder).map(key => key.mblogId)).toEqual(['B', 'A', 'C'])
  })

  it('iterate_requestsPagesUntilHasMoreIsFalse', async () => {
    const pool = [
      makeRecord('A', '2025-01-15T00:00:00.000Z'),
      makeRecord('B', '2025-01-14T00:00:00.000Z'),
      makeRecord('C', '2025-01-13T00:00:00.000Z'),
    ]
    const requests: UserArchiveRecordPageRequest[] = []
    let loadRecordsCalls = 0

    const store = withPage(
      createStoreStub(async () => {
        loadRecordsCalls += 1
        return pool
      }),
      async (request) => {
        requests.push(request)
        // 每页只给一条，验证游标自己推进而不是依赖 limit。
        const start = request.cursor === undefined
          ? 0
          : pool.findIndex(entry => entry.mblogId === request.cursor?.mblogId) + 1
        return { records: pool.slice(start, start + 1), hasMore: start < pool.length - 1 }
      },
    )

    expect(await collect(iterateUserArchiveRecords(store, { limit: 1 }))).toEqual(['A', 'B', 'C'])
    expect(loadRecordsCalls).toBe(0)
    expect(requests.map(request => request.limit)).toEqual([100, 100, 100])
    expect(requests.map(request => request.cursor?.mblogId)).toEqual([undefined, 'A', 'B'])
    expect(requests[1].cursor).toEqual({ createdAt: '2025-01-15T00:00:00.000Z', mblogId: 'A' })
  })

  it('iterate_fallsBackToLoadRecordsWhenPagingIsMissing', async () => {
    const pool = [makeRecord('A', '2025-01-15T00:00:00.000Z'), makeRecord('B', '2025-01-14T00:00:00.000Z')]
    const calls: Array<string | undefined> = []

    const store = createStoreStub(async (slice) => {
      calls.push(slice)
      return pool
    })

    expect(await collect(iterateUserArchiveRecords(store))).toEqual(['A', 'B'])
    expect(calls).toEqual([undefined])
  })

  it('iterate_stopsWhenTheCursorDoesNotAdvance', async () => {
    const record = makeRecord('A', '2025-01-15T00:00:00.000Z')
    const requests: UserArchiveRecordPageRequest[] = []

    const store = withPage(createStoreStub(async () => [record]), async (request) => {
      requests.push(request)
      // 死循环诱饵：始终返回同一条并且声称还有更多。
      return { records: [record], hasMore: true }
    })

    expect(await collect(iterateUserArchiveRecords(store))).toEqual(['A', 'A'])
    expect(requests).toHaveLength(2)
  })

  it('iterate_stopsOnEmptyPageEvenIfHasMore', async () => {
    const store = withPage(createMemoryUserArchiveStore(), async () => ({ records: [], hasMore: true }))
    expect(await collect(iterateUserArchiveRecords(store))).toEqual([])
  })

  it('recordIndex_keepsOneEntryPerMblogIdAndCountsComments', async () => {
    const index = createUserArchiveRecordIndex()
    const issue = { stage: 'comments' as const, code: 'UNKNOWN', message: 'boom' }

    index.add(makeRecord('A', '2025-01-15T00:00:00.000Z', {
      comments: [makeArchiveComment('c1', { replies: [makeArchiveComment('r1')] })],
    }))
    // 同一条重试后更差：不应该覆盖已经完整的一份。
    index.add(makeRecord('A', '2025-01-15T00:00:00.000Z', { issues: [issue] }))

    expect(index.stats()).toEqual({ tweets: 1, comments: 1, replies: 1 })
    expect([...index.completed]).toEqual(['A'])
    expect(index.retryTargets.size).toBe(0)
    expect(index.issues()).toEqual([])
  })

  it('recordIndex_tracksStaleRecordsForRetry', async () => {
    const index = createUserArchiveRecordIndex()
    const issue = { stage: 'detail' as const, code: 'NET_TIMEOUT', message: 'timeout' }
    const stale = makeRecord('B', '2025-01-14T00:00:00.000Z', { issues: [issue] })

    index.add(stale)
    index.add(makeRecord('C', '2025-01-13T00:00:00.000Z'))

    expect(index.retryTargets.get('B')).toEqual(stale)
    expect([...index.completed]).toEqual(['C'])
    expect(index.issues()).toEqual([issue])
    expect(index.stats()).toEqual({ tweets: 2, comments: 0, replies: 0 })

    // 重试成功：正文从重试队列移除，计数沿用本次结果。
    index.add(makeRecord('B', '2025-01-14T00:00:00.000Z', { comments: [makeArchiveComment('c1')] }))
    expect(index.retryTargets.size).toBe(0)
    expect([...index.completed].sort()).toEqual(['B', 'C'])
    expect(index.stats()).toEqual({ tweets: 2, comments: 1, replies: 0 })
  })

  it('memoryStore_pagesInCursorOrderAndMatchesWholeLoad', async () => {
    const store = createMemoryUserArchiveStore()
    for (const [mblogId, createdAt] of [
      ['A', '2025-01-13T00:00:00.000Z'],
      ['C', '2025-01-15T00:00:00.000Z'],
      ['B', '2025-01-14T00:00:00.000Z'],
    ] as const) {
      await store.appendRecord(makeRecord(mblogId, createdAt))
    }

    const paged = await collect(iterateUserArchiveRecords(store))
    expect(paged).toEqual(['C', 'B', 'A'])

    const first = await store.loadRecordsPage!({ limit: 2 })
    expect(first.records.map(entry => entry.mblogId)).toEqual(['C', 'B'])
    expect(first.hasMore).toBe(true)

    const second = await store.loadRecordsPage!({
      limit: 2,
      cursor: { createdAt: '2025-01-14T00:00:00.000Z', mblogId: 'B' },
    })
    expect(second.records.map(entry => entry.mblogId)).toEqual(['A'])
    expect(second.hasMore).toBe(false)

    const filtered = await store.loadRecordsPage!({ slice: 'missing' })
    expect(filtered).toEqual({ records: [], hasMore: false })

    const index = await loadUserArchiveRecordIndex(store)
    expect(index.stats()).toEqual({ tweets: 3, comments: 0, replies: 0 })
  })

  it('memoryStore_keepsOneRowPerMblogIdWhenARecordIsRewritten', async () => {
    const store = createMemoryUserArchiveStore()
    const issue = { stage: 'detail' as const, code: 'NET_TIMEOUT', message: 'timeout' }
    await store.appendRecord(makeRecord('A', '2025-01-15T00:00:00.000Z', { issues: [issue] }))
    await store.appendRecord(makeRecord('A', '2025-01-15T00:00:00.000Z'))

    expect(await store.loadRecords()).toHaveLength(2)

    const paged: string[] = []
    for await (const entry of iterateUserArchiveRecords(store))
      paged.push(entry.mblogId)
    expect(paged).toEqual(['A'])

    const index = await loadUserArchiveRecordIndex(store)
    expect([...index.completed]).toEqual(['A'])
    expect(index.retryTargets.size).toBe(0)
  })
})
