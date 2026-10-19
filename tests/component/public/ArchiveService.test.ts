import type { ArchiveCheckpoint, ArchiveServiceDeps } from '~/services/public/ArchiveService'
import { describe, expect, it, vi } from 'vitest'
import { ArchiveService } from '~/services/public/ArchiveService'

function mkRaw(mblogid: string) {
  return {
    id: 1,
    idstr: mblogid,
    mblogid,
    created_at: 'now',
    text: '',
    text_raw: 'hello',
    user: { id: 2, idstr: '2', screen_name: 'u' },
  }
}

function mkPage(items: unknown[]) {
  return { ok: 1, data: { since_id: '', list: items, total: items.length } }
}

/** myMblog 翻页 mock：第一页返回 page1Items，后续页返回空列表（真实 API 到底语义） */
function mockTimelinePages(myMblog: ReturnType<typeof vi.fn>, page1Items: unknown[]) {
  myMblog.mockImplementation((_uid: string, page?: number) => {
    if (page === undefined || page === 1)
      return Promise.resolve(mkPage(page1Items))
    return Promise.resolve(mkPage([]))
  })
}

function createDeps(overrides?: Partial<ArchiveServiceDeps>): {
  deps: ArchiveServiceDeps
  myMblog: ReturnType<typeof vi.fn>
  getReposts: ReturnType<typeof vi.fn>
  getFavorites: ReturnType<typeof vi.fn>
} {
  const myMblog = vi.fn()
  const getReposts = vi.fn()
  const getFavorites = vi.fn()
  const deps: ArchiveServiceDeps = {
    tweets: { myMblog, getReposts },
    favorites: { getFavorites },
    ...overrides,
  }
  return { deps, myMblog, getReposts, getFavorites }
}

async function collect(stream: AsyncIterableIterator<any>) {
  const out: any[] = []
  for await (const item of stream)
    out.push(item)
  return out
}

describe('archiveService', () => {
  it('chains timeline with inline reposts -> favorites and keeps checkpoint constant-size', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A'), mkRaw('B')])
    getReposts.mockResolvedValue({ ok: 1, data: [mkRaw('R1')], total_number: 1, max_page: 1, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [mkRaw('F1')], total_number: 1 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111') as any)

    // P1-2：转发紧跟所属 timeline item，不再有独立的 reposts 阶段
    expect(items.map(i => i.source)).toEqual(['timeline', 'repost', 'timeline', 'repost', 'favorite'])
    expect(items.map(i => i.mblogId)).toEqual(['A', 'R1', 'B', 'R1', 'F1'])
    // 每条归档 item 自带契约版本（K1 / P0-1 信封层，磁盘条目自描述）
    expect(items.map(i => i.schemaVersion)).toEqual([1, 1, 1, 1, 1])

    // P1-1：checkpoint 恒定大小，不再携带 visitedMblogIds
    expect(Object.keys(items[0].checkpoint).sort()).toEqual([
      'favoritesPage',
      'lastTimelineMblogId',
      'page',
      'phase',
      'uid',
    ])
    expect('visitedMblogIds' in items[4].checkpoint).toBe(false)

    // timeline item A 尚未完成转发 → lastTimelineMblogId 仍为空；B 时 A 已完成
    expect(items[0].checkpoint).toMatchObject({ uid: '111', phase: 'timeline', page: 1 })
    expect(items[0].checkpoint.lastTimelineMblogId).toBeUndefined()
    expect(items[1].checkpoint.lastTimelineMblogId).toBeUndefined()
    expect(items[2].checkpoint.lastTimelineMblogId).toBe('A')
    expect(items[3].checkpoint.lastTimelineMblogId).toBe('A')
    expect(items[4].checkpoint).toMatchObject({ phase: 'favorites', favoritesPage: 1 })

    // P1-2：timeline 只翻一次（第 1 页 + 空页到底），不再重放
    expect(myMblog).toHaveBeenCalledTimes(2)
    expect(myMblog.mock.calls.map(c => c[1])).toEqual([1, 2])
    expect(getReposts).toHaveBeenCalledTimes(2)
    expect(getFavorites).toHaveBeenCalledTimes(1)
  })

  it('resumes from checkpoint (phase=favorites) and skips earlier phases', async () => {
    const { deps, myMblog, getFavorites } = createDeps()
    const checkpoint: ArchiveCheckpoint = {
      uid: '111',
      phase: 'favorites',
      favoritesPage: 2,
    }
    myMblog.mockResolvedValue(mkPage([]))
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [mkRaw('F2')], total_number: 1 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { checkpoint }) as any)

    expect(items).toHaveLength(1)
    expect(items[0].source).toBe('favorite')
    expect(items[0].checkpoint.favoritesPage).toBe(2)
    // timeline 阶段不重放
    expect(myMblog).not.toHaveBeenCalled()
  })

  it('resumes mid-timeline using lastTimelineMblogId', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A'), mkRaw('B')])
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const checkpoint: ArchiveCheckpoint = {
      uid: '111',
      phase: 'timeline',
      page: 1,
      lastTimelineMblogId: 'A',
    }
    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { checkpoint }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['B'])
    // A 已完成，不再请求其转发
    expect(getReposts).toHaveBeenCalledTimes(1)
    expect(getReposts.mock.calls[0][0]).toBe('B')
  })

  it('normalizes legacy reposts checkpoint back to timeline', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A'), mkRaw('B')])
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    // P1-2 之前的 checkpoint：reposts 阶段 + lastMblogId + visitedMblogIds
    const checkpoint = {
      uid: '111',
      phase: 'reposts',
      lastMblogId: 'A',
      visitedMblogIds: ['A'],
    } as unknown as ArchiveCheckpoint

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { checkpoint }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['B'])
    expect(getReposts).toHaveBeenCalledTimes(1)
    expect(getReposts.mock.calls[0][0]).toBe('B')
  })

  it('dedupes duplicate ids within a page', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A'), mkRaw('A'), mkRaw('B')])
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111') as any)

    expect(items.map(i => i.mblogId)).toEqual(['A', 'B'])
  })

  it('stops when upstream repeats the same page (page ignored)', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    // 无论 page 多少都返回同一页 → 必须在第 2 次请求后停止
    myMblog.mockResolvedValue(mkPage([mkRaw('A')]))
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { maxPagesPerPhase: 5 }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A'])
    expect(myMblog.mock.calls.map(c => c[1])).toEqual([1, 2])
  })

  it('produces schemaDigest structure snapshot for drift detection (A7)', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A')])
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111') as any)

    const digest = items[0].schemaDigest as Record<string, unknown>
    // 结构快照只保留 key 路径 + 值类型：所有字符串统一为 <STR>
    expect(digest.mblogid).toBe('<STR>')
    expect(digest.idstr).toBe('<STR>')
    expect(digest.created_at).toBe('<STR>')
    expect(digest.text_raw).toBe('<STR>')
    expect(digest.id).toBe('<NUM>')
    expect(digest.user).toEqual({ id: '<NUM>', idstr: '<STR>', screen_name: '<STR>' })
  })

  it('delivers raw items via onRaw without adding raw to ArchiveItem (P1-9)', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A'), mkRaw('B')])
    getReposts.mockResolvedValue({ ok: 1, data: [mkRaw('R1')], total_number: 1, max_page: 1, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [mkRaw('F1')], total_number: 1 } })

    const calls: Array<{ raw: any, meta: any }> = []
    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      onRaw: (raw, meta) => {
        calls.push({ raw, meta })
      },
    }) as any)

    expect(calls.map(c => c.meta.source)).toEqual(['timeline', 'repost', 'timeline', 'repost', 'favorite'])
    expect(calls[0].meta).toEqual({ uid: '111', source: 'timeline', mblogId: 'A', page: 1 })
    expect(calls[1].meta).toEqual({ uid: '111', source: 'repost', mblogId: 'R1', page: 1, parentMblogId: 'A' })
    expect(calls[2].meta).toEqual({ uid: '111', source: 'timeline', mblogId: 'B', page: 1 })
    expect(calls[3].meta).toEqual({ uid: '111', source: 'repost', mblogId: 'R1', page: 1, parentMblogId: 'B' })
    expect(calls[4].meta).toEqual({ uid: '111', source: 'favorite', mblogId: 'F1', page: 1 })
    expect(calls[1].raw.mblogid).toBe('R1')

    // 契约 §4.1：归档信封不新增 raw 字段
    expect(items.every(item => !('raw' in item))).toBe(true)
  })

  it('surfaces onRaw errors instead of silently dropping raw', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A')])
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)

    await expect(collect(service.streamArchive('111', {
      onRaw: () => {
        throw new Error('disk full')
      },
    }) as any)).rejects.toThrow('disk full')
  })

  it('honors includeReposts=false to skip inline reposts', async () => {
    const { deps, getReposts, getFavorites } = createDeps()
    const { myMblog } = deps.tweets as any
    mockTimelinePages(myMblog, [mkRaw('A')])
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { includeReposts: false }) as any)

    expect(items.map(i => i.source)).toEqual(['timeline'])
    // 无转发时该 item 本身即视为完成，恢复时不会重复
    expect(items[0].checkpoint.lastTimelineMblogId).toBe('A')
    expect(getReposts).not.toHaveBeenCalled()
    expect(getFavorites).toHaveBeenCalledTimes(1)
  })

  it('paginates timeline with page cursor across pages', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    // page=1 → [A]；page=2 → [B]；page=3 → 空（到底）
    myMblog.mockImplementation((_uid, page) => {
      if (page === 1)
        return Promise.resolve(mkPage([mkRaw('A')]))
      if (page === 2)
        return Promise.resolve(mkPage([mkRaw('B')]))
      return Promise.resolve(mkPage([]))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { maxPagesPerPhase: 3 }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A', 'B'])
    // 不再重放 timeline
    expect(myMblog.mock.calls.map(c => c[1])).toEqual([1, 2, 3])
    // checkpoint.page = 该项所在的**当前页**（第二页 → 2，恢复时重跑该页）
    expect(items[1].checkpoint.page).toBe(2)
  })
})
