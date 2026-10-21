import type { ArchiveCheckpoint, ArchiveServiceDeps } from '~/services/public/ArchiveService'
import { describe, expect, it, vi } from 'vitest'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { NetworkRequestError } from '~/models/errors/TransportError'
import { ArchiveService } from '~/services/public/ArchiveService'

function mkRaw(mblogid: string, createdAt = 'now') {
  return {
    id: 1,
    idstr: mblogid,
    mblogid,
    created_at: createdAt,
    text: '',
    text_raw: 'hello',
    user: { id: 2, idstr: '2', screen_name: 'u' },
  }
}

function mkPage(items: unknown[], total = items.length) {
  return { ok: 1, data: { since_id: '', list: items, total } }
}

function mkSearchPage(items: unknown[], total: number | string = items.length) {
  return { ok: 1, data: { list: items, total } }
}

function ts(value: string): number {
  return Math.floor(Date.parse(value) / 1000)
}

/** myMblog 翻页 mock：第一页返回 page1Items，后续页返回空列表（真实 API 到底语义） */
function mockTimelinePages(myMblog: ReturnType<typeof vi.fn>, page1Items: unknown[]) {
  myMblog.mockImplementation((_uid: string, page?: number) => {
    if (page === undefined || page === 1)
      return Promise.resolve(mkPage(page1Items))
    return Promise.resolve(mkPage([]))
  })
}

function mkComment(id: string, opts: { text?: string, likes?: number, replies?: unknown[] } = {}) {
  const text = opts.text ?? id
  return {
    id,
    idstr: id,
    created_at: 'Mon Oct 19 12:00:00 +0800 2026',
    text: `<b>${text}</b>`,
    text_raw: text,
    source: '来自 北京',
    like_counts: opts.likes ?? 3,
    user: { id: 9, idstr: '9', screen_name: 'commenter', avatar_hd: '', verified: false, verified_type: 0 },
    comments: opts.replies,
  }
}

function createDeps(overrides?: Partial<ArchiveServiceDeps>): {
  deps: ArchiveServiceDeps
  myMblog: ReturnType<typeof vi.fn>
  getReposts: ReturnType<typeof vi.fn>
  getFavorites: ReturnType<typeof vi.fn>
  searchByDate: ReturnType<typeof vi.fn>
  comments: ReturnType<typeof vi.fn>
} {
  const myMblog = vi.fn()
  const getReposts = vi.fn()
  const getFavorites = vi.fn()
  const searchByDate = vi.fn()
  const comments = vi.fn()
  const deps: ArchiveServiceDeps = {
    tweets: { fetchRawUserTimelinePage: myMblog, getReposts, searchByDate, comments },
    favorites: { getFavorites },
    ...overrides,
  }
  return { deps, myMblog, getReposts, getFavorites, searchByDate, comments }
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
    expect(items.map(i => i.schemaVersion)).toEqual([2, 2, 2, 2, 2])

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
    const { fetchRawUserTimelinePage: myMblog } = deps.tweets as any
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

  it('continues with searchProfile date slices when mymblog total has remaining items (P1-5)', async () => {
    const { deps, myMblog, getReposts, getFavorites, searchByDate } = createDeps()
    const A = ts('2026-10-19T00:00:00+08:00')
    const B = ts('2026-10-18T00:00:00+08:00')
    const since = ts('2026-10-01T00:00:00+08:00')

    // mymblog 只翻到 2 条，但 total=5 → 必须继续日期切片
    myMblog.mockImplementation((_uid, page) => {
      if (page === 1)
        return Promise.resolve(mkPage([mkRaw('A', '2026-10-19T00:00:00+08:00'), mkRaw('B', '2026-10-18T00:00:00+08:00')], 5))
      return Promise.resolve(mkPage([], 5))
    })
    searchByDate.mockImplementation((_uid, options) => {
      expect(options.starttime).toBe(since)
      expect(options.endtime).toBe(B - 1)
      if (options.page === 1)
        return Promise.resolve(mkSearchPage([mkRaw('C', '2026-10-17T00:00:00+08:00'), mkRaw('D', '2026-10-16T00:00:00+08:00')], '3'))
      return Promise.resolve(mkSearchPage([mkRaw('E', '2026-10-15T00:00:00+08:00')], 3))
    })
    getReposts.mockImplementation((id: string) =>
      id === 'C'
        ? Promise.resolve({ ok: 1, data: [mkRaw('RC')], total_number: 1, max_page: 1, next_cursor: 0, empty_tip: '' })
        : Promise.resolve({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' }),
    )
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { since }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A', 'B', 'C', 'RC', 'D', 'E'])
    expect(items.map(i => i.source)).toEqual(['timeline', 'timeline', 'timeline', 'repost', 'timeline', 'timeline'])

    // 切片内沿用同一套 page 翻页；checkpoint 记录 slice 游标
    expect(searchByDate.mock.calls.map(c => c[1].page)).toEqual([1, 2])
    expect(items[2].checkpoint.sliceEnd).toBe(B - 1)
    expect(items[2].checkpoint.slicePage).toBe(1)
    expect(items[2].checkpoint.sliceWindow).toBe(30 * 24 * 60 * 60)
    // 日期切片不产生独立 reposts 阶段；转发 checkpoint 与所属 timeline 项一致
    expect(items[3].checkpoint.sliceEnd).toBe(B - 1)
    expect(A).toBeGreaterThan(B)
  })

  it('skips date slices when mymblog total proves completeness', async () => {
    const { deps, myMblog, getReposts, getFavorites, searchByDate } = createDeps()
    const since = ts('2026-10-01T00:00:00+08:00')
    myMblog.mockImplementation((_uid, page) => {
      if (page === 1)
        return Promise.resolve(mkPage([mkRaw('A', '2026-10-19T00:00:00+08:00'), mkRaw('B', '2026-10-18T00:00:00+08:00')], 2))
      return Promise.resolve(mkPage([], 2))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { since }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A', 'B'])
    expect(searchByDate).not.toHaveBeenCalled()
  })

  it('halves the date window when a slice is too dense', async () => {
    const { deps, myMblog, getReposts, getFavorites, searchByDate } = createDeps()
    const B = ts('2026-10-18T00:00:00+08:00')
    const since = ts('2026-01-01T00:00:00+08:00')
    myMblog.mockImplementation((_uid, page) => {
      if (page === 1)
        return Promise.resolve(mkPage([mkRaw('A', '2026-10-19T00:00:00+08:00'), mkRaw('B', '2026-10-18T00:00:00+08:00')], 5))
      return Promise.resolve(mkPage([], 5))
    })

    let call = 0
    searchByDate.mockImplementation((_uid, options) => {
      call += 1
      if (call === 1) {
        // 30 天窗口太密 → 触发对半缩小
        expect(options.endtime).toBe(B - 1)
        expect(options.starttime).toBe(B - 30 * 24 * 60 * 60)
        return Promise.resolve(mkSearchPage([mkRaw('C', '2026-10-10T00:00:00+08:00')], 1000))
      }
      if (call === 2) {
        // 缩小到 15 天后处理同一区间
        expect(options.endtime).toBe(B - 1)
        expect(options.starttime).toBe(B - 15 * 24 * 60 * 60)
        return Promise.resolve(mkSearchPage([mkRaw('C', '2026-10-10T00:00:00+08:00')], 100))
      }
      if (call === 3)
        return Promise.resolve(mkSearchPage([], 100))
      // 更早的区间为空 → 直接跨过（adaptive window 会放大）
      return Promise.resolve(mkSearchPage([], 0))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { since }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A', 'B', 'C'])
    expect(searchByDate.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(searchByDate.mock.calls[0][1]).toMatchObject({ page: 1, starttime: B - 30 * 24 * 60 * 60, endtime: B - 1 })
    expect(searchByDate.mock.calls[1][1]).toMatchObject({ page: 1, starttime: B - 15 * 24 * 60 * 60, endtime: B - 1 })
    expect(searchByDate.mock.calls[2][1]).toMatchObject({ page: 2, starttime: B - 15 * 24 * 60 * 60, endtime: B - 1 })
  })

  it('resumes inside a date slice using slicePage + lastTimelineMblogId', async () => {
    const { deps, myMblog, getReposts, getFavorites, searchByDate } = createDeps()
    const sliceEnd = ts('2026-10-18T00:00:00+08:00')
    const since = ts('2026-10-01T00:00:00+08:00')
    const checkpoint: ArchiveCheckpoint = {
      uid: '111',
      phase: 'timeline',
      sliceEnd,
      slicePage: 2,
      sliceWindow: 30 * 24 * 60 * 60,
      lastTimelineMblogId: 'C',
    }
    searchByDate.mockImplementation((_uid, options) => {
      if (options.page === 1)
        return Promise.resolve(mkSearchPage([mkRaw('A'), mkRaw('B'), mkRaw('C'), mkRaw('D')], 4))
      if (options.page === 2)
        return Promise.resolve(mkSearchPage([mkRaw('C'), mkRaw('D'), mkRaw('E')], 4))
      return Promise.resolve(mkSearchPage([], 4))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { checkpoint, since }) as any)

    // mymblog 不重放；当前页内 C 已处理，只产出 D、E
    expect(myMblog).not.toHaveBeenCalled()
    expect(items.map(i => i.mblogId)).toEqual(['D', 'E'])
    expect(items[0].checkpoint.slicePage).toBe(2)
    expect(items[0].checkpoint.sliceEnd).toBe(sliceEnd)
  })

  it('stops a date slice when upstream page resets to newer items', async () => {
    const { deps, myMblog, getReposts, getFavorites, searchByDate } = createDeps()
    const since = ts('2026-10-01T00:00:00+08:00')
    myMblog.mockImplementation((_uid, page) => {
      if (page === 1)
        return Promise.resolve(mkPage([mkRaw('A', '2026-10-19T00:00:00+08:00'), mkRaw('B', '2026-10-18T00:00:00+08:00')], 5))
      return Promise.resolve(mkPage([], 5))
    })
    searchByDate.mockImplementation((_uid, options) => {
      if (options.page === 1)
        return Promise.resolve(mkSearchPage([mkRaw('C', '2026-10-17T00:00:00+08:00')], 100))
      if (options.page === 2)
        return Promise.resolve(mkSearchPage([mkRaw('D', '2026-10-16T00:00:00+08:00')], 100))
      if (options.page === 3)
        return Promise.resolve(mkSearchPage([mkRaw('E', '2026-10-18T00:00:00+08:00')], 100))
      return Promise.resolve(mkSearchPage([], 100))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { since }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A', 'B', 'C', 'D'])
    expect(searchByDate.mock.calls.map(c => c[1].page)).toEqual([1, 2, 3])
  })

  it('re-primes searchProfile when a page returns another date window', async () => {
    const { deps, myMblog, getReposts, getFavorites, searchByDate } = createDeps()
    const until = ts('2026-10-18T00:00:00+08:00')
    const since = ts('2026-10-01T00:00:00+08:00')

    let page2Calls = 0
    searchByDate.mockImplementation((_uid, options) => {
      if (options.page === 1)
        return Promise.resolve(mkSearchPage([mkRaw('B', '2026-10-17T00:00:00+08:00')], 2))
      page2Calls += 1
      // 第一次 page=2 被另一个窗口的查询覆盖：日期与 total 都不属于当前切片。
      if (page2Calls === 1)
        return Promise.resolve(mkSearchPage([mkRaw('X', '2026-10-25T00:00:00+08:00')], 5))
      return Promise.resolve(mkSearchPage([mkRaw('C', '2026-10-16T00:00:00+08:00')], 2))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      timelineSource: 'search',
      since,
      until,
    }) as any)

    expect(myMblog).not.toHaveBeenCalled()
    expect(items.map(i => i.mblogId)).toEqual(['B', 'C'])
    // page=2 异常 → 重新请求 page=1 恢复会话 → 再重试 page=2
    expect(searchByDate.mock.calls.map(c => c[1].page)).toEqual([1, 2, 1, 2])
  })

  it('re-primes searchProfile when a page is empty but results remain', async () => {
    const { deps, getReposts, getFavorites, searchByDate } = createDeps()
    const until = ts('2026-10-18T00:00:00+08:00')
    const since = ts('2026-10-01T00:00:00+08:00')

    let page2Calls = 0
    searchByDate.mockImplementation((_uid, options) => {
      if (options.page === 1)
        return Promise.resolve(mkSearchPage([mkRaw('B', '2026-10-17T00:00:00+08:00')], 2))
      page2Calls += 1
      if (page2Calls === 1)
        return Promise.resolve(mkSearchPage([], 0))
      return Promise.resolve(mkSearchPage([mkRaw('C', '2026-10-16T00:00:00+08:00')], 2))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      timelineSource: 'search',
      since,
      until,
    }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['B', 'C'])
  })

  it('throws when searchProfile keeps returning another date window', async () => {
    const { deps, getReposts, getFavorites, searchByDate } = createDeps()
    const until = ts('2026-10-18T00:00:00+08:00')
    const since = ts('2026-10-01T00:00:00+08:00')

    searchByDate.mockImplementation((_uid, options) => {
      if (options.page === 1)
        return Promise.resolve(mkSearchPage([mkRaw('B', '2026-10-17T00:00:00+08:00')], 2))
      return Promise.resolve(mkSearchPage([mkRaw('X', '2026-10-25T00:00:00+08:00')], 5))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const error = await collect(service.streamArchive('111', {
      timelineSource: 'search',
      since,
      until,
    }) as any).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(UnexpectedAPIResponseError)
    expect(error).toMatchObject({ code: 'API_BAD_RESPONSE' })
    expect((error as UnexpectedAPIResponseError).context).toMatchObject({ page: 2, sliceStart: since, sliceEnd: until })
  })

  it('skips mymblog entirely when timelineSource=search', async () => {
    const { deps, myMblog, getReposts, getFavorites, searchByDate } = createDeps()
    const until = ts('2026-10-18T00:00:00+08:00')
    const since = ts('2026-10-15T00:00:00+08:00')
    searchByDate.mockImplementation((_uid, options) => {
      expect(options.endtime).toBe(until)
      expect(options.starttime).toBe(since)
      return Promise.resolve(mkSearchPage([mkRaw('C', '2026-10-17T00:00:00+08:00')], 1))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      timelineSource: 'search',
      until,
      since,
    }) as any)

    expect(myMblog).not.toHaveBeenCalled()
    expect(items.map(i => i.mblogId)).toEqual(['C'])
  })

  it('throws when timelineSource=search but searchByDate is unavailable', async () => {
    const { deps } = createDeps({
      tweets: { fetchRawUserTimelinePage: vi.fn(), getReposts: vi.fn() },
      favorites: { getFavorites: vi.fn() },
    })
    const service = new ArchiveService(deps)
    await expect(collect(service.streamArchive('111', { timelineSource: 'search' }) as any))
      .rejects
      .toThrow('timelineSource="search" requires')
  })

  it('reports archive progress and telemetry per page (P1-3)', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    const events: any[] = []
    deps.telemetry = {
      emit: vi.fn(async (event) => {
        events.push(event)
      }),
    }
    mockTimelinePages(myMblog, [mkRaw('A'), mkRaw('B')])
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const progress: any[] = []
    const service = new ArchiveService(deps)
    await collect(service.streamArchive('111', {
      onProgress: (p) => {
        progress.push(p)
      },
    }) as any)

    expect(progress[0]).toMatchObject({ uid: '111', phase: 'timeline', processed: 0 })
    expect(progress).toContainEqual(expect.objectContaining({
      phase: 'timeline',
      source: 'mymblog',
      processed: 2,
      total: 2,
      remaining: 0,
      page: 1,
    }))
    expect(progress.at(-1)).toMatchObject({ phase: 'done', source: 'done', processed: 2 })

    const telemetry = events.filter(e => e.event_name === 'archive_progress')
    expect(telemetry.length).toBeGreaterThanOrEqual(3)
    expect(telemetry).toContainEqual(expect.objectContaining({
      uid: '111',
      processed: 2,
      total: 2,
      remaining: 0,
    }))
  })

  it('skips a failed repost page and keeps archiving the rest (P1-4)', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A'), mkRaw('B')])
    getReposts.mockImplementation((id: string) => {
      if (id === 'A')
        return Promise.reject(new NetworkRequestError('repost page down'))
      return Promise.resolve({ ok: 1, data: [mkRaw('RB')], total_number: 1, max_page: 1, next_cursor: 0, empty_tip: '' })
    })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const errors: any[] = []
    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      onItemError: (_error, context) => {
        errors.push(context)
      },
    }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A', 'B', 'RB'])
    expect(errors[0]).toMatchObject({
      stage: 'reposts',
      source: 'repost',
      parentMblogId: 'A',
      page: 1,
    })
    expect(getReposts).toHaveBeenCalledTimes(2)
  })

  it('retries a retryable repost failure when onItemError returns retry (P1-4)', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A')])
    let first = true
    getReposts.mockImplementation(() => {
      if (first) {
        first = false
        return Promise.reject(new NetworkRequestError('temporary'))
      }
      return Promise.resolve({ ok: 1, data: [mkRaw('R')], total_number: 1, max_page: 1, next_cursor: 0, empty_tip: '' })
    })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const onItemError = vi.fn(() => 'retry' as const)
    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { onItemError }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A', 'R'])
    expect(onItemError).toHaveBeenCalledTimes(1)
    expect(getReposts).toHaveBeenCalledTimes(2)
  })

  it('aborts on repost failure when policy is abort (P1-4)', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A')])
    getReposts.mockRejectedValue(new NetworkRequestError('down'))
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    await expect(collect(service.streamArchive('111', { repostErrorPolicy: 'abort' }) as any))
      .rejects
      .toThrow('down')
  })

  it('fetches and normalizes comments into tweet.comments (P1-6)', async () => {
    const { deps, myMblog, getReposts, getFavorites, comments } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A')])
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [mkRaw('F')], total_number: 1 } })
    comments.mockImplementation((_id: string, options: { max_id?: number }) => {
      if (options.max_id === undefined) {
        return Promise.resolve({
          ok: 1,
          data: [
            mkComment('c1', { text: 'hello', likes: 7 }),
            mkComment('c2', { replies: [mkComment('r1')] }),
          ],
          total_number: 3,
          max_id: 111,
        })
      }
      return Promise.resolve({
        ok: 1,
        data: [mkComment('c3')],
        total_number: 3,
        max_id: 0,
      })
    })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { includeComments: true }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A', 'F'])
    const tweet = items[0].tweet
    expect(tweet.comments).toHaveLength(3)
    expect(tweet.comments[0]).toMatchObject({
      id: 'c1',
      text: 'hello',
      likes: 7,
      source: '来自 北京',
      user: { id: '9', name: 'commenter', verified: false },
    })
    expect(tweet.comments[1].replies).toHaveLength(1)
    expect(tweet.comments[1].replies[0].id).toBe('r1')
    // favorite 项不拉评论
    expect(comments.mock.calls.map(c => c[0])).toEqual(['A', 'A'])
    expect(items[1].tweet.comments).toBeUndefined()
  })

  it('prefetches per-item requests within a page without reordering output', async () => {
    const { deps, myMblog, getReposts, getFavorites, comments } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A'), mkRaw('B'), mkRaw('C')])
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const started: string[] = []
    const releases = new Map<string, () => void>()
    comments.mockImplementation((id: string) => {
      started.push(id)
      return new Promise((resolve) => {
        releases.set(id, () => resolve({
          ok: 1,
          data: [mkComment(`c-${id}`)],
          total_number: 1,
          max_id: 0,
        }))
      })
    })

    const service = new ArchiveService(deps)
    const iterator = service.streamArchive('111', {
      includeComments: true,
      concurrency: 3,
    })[Symbol.asyncIterator]()

    const first = iterator.next()
    // A 还在等评论时，窗口内 B / C 的评论请求已经发出。
    await vi.waitFor(() => expect(started).toEqual(['A', 'B', 'C']))

    releases.get('A')!()
    const itemA = await first
    expect(itemA.value.mblogId).toBe('A')
    expect(itemA.value.tweet.comments).toHaveLength(1)

    releases.get('B')!()
    const itemB = await iterator.next()
    expect(itemB.value.mblogId).toBe('B')
    // checkpoint 仍按完成顺序推进：B 的断点指向 A。
    expect(itemB.value.checkpoint.lastTimelineMblogId).toBe('A')

    releases.get('C')!()
    const itemC = await iterator.next()
    expect(itemC.value.mblogId).toBe('C')
    expect(itemC.value.checkpoint.lastTimelineMblogId).toBe('B')
    expect(started).toEqual(['A', 'B', 'C'])

    await iterator.next()
  })

  it('does not look ahead when concurrency is 1', async () => {
    const { deps, myMblog, getReposts, getFavorites, comments } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A'), mkRaw('B')])
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const started: string[] = []
    const releases = new Map<string, () => void>()
    comments.mockImplementation((id: string) => {
      started.push(id)
      return new Promise((resolve) => {
        releases.set(id, () => resolve({
          ok: 1,
          data: [mkComment(`c-${id}`)],
          total_number: 1,
          max_id: 0,
        }))
      })
    })

    const service = new ArchiveService(deps)
    const iterator = service.streamArchive('111', {
      includeComments: true,
      concurrency: 1,
    })[Symbol.asyncIterator]()

    const first = iterator.next()
    await vi.waitFor(() => expect(started).toEqual(['A']))

    releases.get('A')!()
    await first

    const second = iterator.next()
    await vi.waitFor(() => expect(started).toEqual(['A', 'B']))
    expect(started).toEqual(['A', 'B'])

    releases.get('B')!()
    await second
    await iterator.next()
  })

  it('starts the first repost page together with the parent comments', async () => {
    const { deps, myMblog, getReposts, getFavorites, comments } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A')])
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    let releaseComments!: () => void
    comments.mockImplementation(() => new Promise((resolve) => {
      releaseComments = () => resolve({ ok: 1, data: [mkComment('c1')], total_number: 1, max_id: 0 })
    }))
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })

    const service = new ArchiveService(deps)
    const iterator = service.streamArchive('111', { includeComments: true })[Symbol.asyncIterator]()
    const first = iterator.next()

    await vi.waitFor(() => {
      expect(comments).toHaveBeenCalledTimes(1)
      expect(getReposts).toHaveBeenCalledWith('A', { page: 1 })
    })

    releaseComments()
    await first
    await iterator.next()
  })

  it('continues without comments when comment fetch fails (P1-6/P1-4)', async () => {
    const { deps, myMblog, getReposts, getFavorites, comments } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A')])
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })
    comments.mockRejectedValue(new NetworkRequestError('comments down'))

    const errors: any[] = []
    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeComments: true,
      onItemError: (_error, context) => {
        errors.push(context)
      },
    }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A'])
    expect(items[0].tweet.comments).toBeUndefined()
    expect(errors[0]).toMatchObject({ stage: 'comments', source: 'timeline', mblogId: 'A' })
  })

  it('throws when includeComments=true but comments dependency is missing', async () => {
    const { deps } = createDeps({
      tweets: { fetchRawUserTimelinePage: vi.fn(), getReposts: vi.fn() },
      favorites: { getFavorites: vi.fn() },
    })
    const service = new ArchiveService(deps)
    await expect(collect(service.streamArchive('111', { includeComments: true }) as any))
      .rejects
      .toThrow('includeComments=true requires')
  })

  it('streams 10k timeline items with a constant-size checkpoint (DoD scale)', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    const total = 10_000
    const perPage = 20
    const lastPage = total / perPage

    myMblog.mockImplementation((_uid, page: number) => {
      if (page > lastPage)
        return Promise.resolve(mkPage([], total))
      const items = Array.from({ length: perPage }, (_, index) =>
        mkRaw(`M${(page - 1) * perPage + index}`, '2026-10-19T00:00:00+08:00'))
      return Promise.resolve(mkPage(items, total))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    let lastProcessed = 0
    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      onProgress: (progress) => {
        lastProcessed = progress.processed
      },
    }) as any)

    expect(items).toHaveLength(total)
    expect(lastProcessed).toBe(total)
    expect(myMblog).toHaveBeenCalledTimes(lastPage + 1)
    // P1-1：checkpoint 恒定大小（不含全量 id 数组）
    expect(Object.keys(items[total - 1].checkpoint).sort()).toEqual([
      'favoritesPage',
      'lastTimelineMblogId',
      'page',
      'phase',
      'uid',
    ])
    expect(JSON.stringify(items[total - 1].checkpoint).length).toBeLessThan(300)
  })
})
