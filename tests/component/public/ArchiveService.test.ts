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
  it('chains timeline -> reposts -> favorites and advances checkpoint', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    mockTimelinePages(myMblog, [mkRaw('A'), mkRaw('B')])
    getReposts.mockResolvedValue({ ok: 1, data: [mkRaw('R1')], total_number: 1, max_page: 1, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [mkRaw('F1')], total_number: 1 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111') as any)

    expect(items.map(i => i.source)).toEqual(['timeline', 'timeline', 'repost', 'repost', 'favorite'])
    // 每条归档 item 自带契约版本（K1 / P0-1 信封层，磁盘条目自描述）
    expect(items.map(i => i.schemaVersion)).toEqual([1, 1, 1, 1, 1])
    expect(items[0].mblogId).toBe('A')
    expect(items[2].mblogId).toBe('R1')
    expect(items[4].mblogId).toBe('F1')

    // 最后一个 favorite item 的 checkpoint 仍处于 favorites 阶段（done 是流结束后的内部态）
    expect(items[4].checkpoint.phase).toBe('favorites')
    // 每条 timeline item 携带 page（下一页页码；第一页 → 2）
    expect(items[0].checkpoint.page).toBe(2)
    // 每个 item 都是归一化 Tweet
    expect(items[0].tweet.mblogId).toBe('A')
    // 访问去重列表累积
    expect(items[4].checkpoint.visitedMblogIds).toContain('R1')

    // timeline 阶段 2 次（第 1 页 + 空页到底）+ collect 重放 2 次
    expect(myMblog).toHaveBeenCalledTimes(4)
    expect(myMblog.mock.calls.map(c => c[1])).toEqual([1, 2, 1, 2])
    expect(getReposts).toHaveBeenCalledTimes(2)
    expect(getFavorites).toHaveBeenCalledTimes(1)
  })

  it('resumes from checkpoint (phase=favorites) and skips earlier phases', async () => {
    const { deps, myMblog, getFavorites } = createDeps()
    const checkpoint: ArchiveCheckpoint = {
      uid: '111',
      phase: 'favorites',
      favoritesPage: 2,
      visitedMblogIds: ['A', 'B', 'R1'],
    }
    myMblog.mockResolvedValue(mkPage([]))
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [mkRaw('F2')], total_number: 1 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { checkpoint }) as any)

    expect(items).toHaveLength(1)
    expect(items[0].source).toBe('favorite')
    expect(items[0].checkpoint.favoritesPage).toBe(2)
    // timeline/reposts 阶段不重放
    expect(myMblog).not.toHaveBeenCalled()
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

  it('honors includeReposts=false to skip the reposts phase', async () => {
    const { deps, getReposts, getFavorites } = createDeps()
    const { myMblog } = deps.tweets as any
    mockTimelinePages(myMblog, [mkRaw('A')])
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { includeReposts: false }) as any)

    expect(items.map(i => i.source)).toEqual(['timeline'])
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
    // timeline 阶段 3 次（page 1,2,3）+ collect 重放 3 次
    expect(myMblog.mock.calls.map(c => c[1])).toEqual([1, 2, 3, 1, 2, 3])
    // checkpoint.page = 该项所在页的下一页页码（第二页 → 3）
    expect(items[1].checkpoint.page).toBe(3)
  })
})
