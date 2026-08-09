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

function mkPage(items: unknown[], sinceId = '') {
  return { ok: 1, data: { since_id: sinceId, list: items, total: items.length } }
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
    myMblog.mockResolvedValue(mkPage([mkRaw('A'), mkRaw('B')], ''))
    getReposts.mockResolvedValue({ ok: 1, data: [mkRaw('R1')], total_number: 1, max_page: 1, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [mkRaw('F1')], total_number: 1 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111') as any)

    expect(items.map(i => i.source)).toEqual(['timeline', 'timeline', 'repost', 'repost', 'favorite'])
    expect(items[0].mblogId).toBe('A')
    expect(items[2].mblogId).toBe('R1')
    expect(items[4].mblogId).toBe('F1')

    // 最后一个 favorite item 的 checkpoint 仍处于 favorites 阶段（done 是流结束后的内部态）
    expect(items[4].checkpoint.phase).toBe('favorites')
    // 每条 timeline item 携带 sinceId（空串 = 无更多）
    expect(items[0].checkpoint.sinceId).toBe('')
    // 每个 item 都是归一化 Tweet
    expect(items[0].tweet.mblogId).toBe('A')
    // 访问去重列表累积
    expect(items[4].checkpoint.visitedMblogIds).toContain('R1')

    // reposts 阶段重新翻 timeline 获取微博 id
    expect(myMblog).toHaveBeenCalledTimes(2)
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
    myMblog.mockResolvedValue(mkPage([mkRaw('A')], ''))
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111') as any)

    const digest = items[0].schemaDigest as Record<string, unknown>
    expect(digest.mblogid).toBe('<ID>')
    expect(digest.idstr).toBe('<ID>')
    expect(digest.created_at).toBe('<DATE>')
    expect(digest.text_raw).toBe('<STR>') // 内容字段在结构快照中替换为类型占位符
  })

  it('honors includeReposts=false to skip the reposts phase', async () => {
    const { deps, getReposts, getFavorites } = createDeps()
    const { myMblog } = deps.tweets as any
    myMblog.mockResolvedValue(mkPage([mkRaw('A')], ''))
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { includeReposts: false }) as any)

    expect(items.map(i => i.source)).toEqual(['timeline'])
    expect(getReposts).not.toHaveBeenCalled()
    expect(getFavorites).toHaveBeenCalledTimes(1)
  })

  it('paginates timeline with since_id cursor across pages', async () => {
    const { deps, myMblog, getReposts, getFavorites } = createDeps()
    // 基于 sinceId 参数返回对应页（timeline 阶段 + collect 重放共用同一 mock）
    myMblog.mockImplementation((_uid, sinceId) => {
      if (sinceId === undefined)
        return Promise.resolve(mkPage([mkRaw('A')], 'cur1'))
      if (sinceId === 'cur1')
        return Promise.resolve(mkPage([mkRaw('B')], 'cur2'))
      return Promise.resolve(mkPage([mkRaw('C')], ''))
    })
    getReposts.mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
    getFavorites.mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', { maxPagesPerPhase: 3 }) as any)

    expect(items.map(i => i.mblogId)).toEqual(['A', 'B', 'C'])
    // timeline 阶段 3 次 + collect 重放 3 次，since_id 均从 undefined 推进
    expect(myMblog.mock.calls.map(c => c[1])).toEqual([undefined, 'cur1', 'cur2', undefined, 'cur1', 'cur2'])
    // checkpoint.sinceId = 该项所在页 raw 返回的下一页游标
    expect(items[1].checkpoint.sinceId).toBe('cur2')
  })
})
