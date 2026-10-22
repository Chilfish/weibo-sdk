import type { MyMBlogItem } from '~/services/endpoints/tweet'
import type { ArchiveServiceDeps } from '~/services/public/ArchiveService'
import { describe, expect, it, vi } from 'vitest'
import { ArchiveService } from '~/services/public/ArchiveService'

function mkRaw(mblogid: string, createdAt = '2026-10-19T00:00:00+08:00', extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    idstr: mblogid,
    mblogid,
    created_at: createdAt,
    text: '',
    text_raw: `text-${mblogid}`,
    user: { id: 2, idstr: '2', screen_name: 'u' },
    ...extra,
  }
}

function mkPage(items: MyMBlogItem[]) {
  return { ok: 1, data: { since_id: '', list: items, total: items.length } }
}

function createDeps(items: MyMBlogItem[]): { deps: ArchiveServiceDeps, myMblog: ReturnType<typeof vi.fn> } {
  const myMblog = vi.fn()
    .mockResolvedValueOnce(mkPage(items))
    .mockResolvedValue(mkPage([]))
  const deps: ArchiveServiceDeps = {
    tweets: {
      fetchRawUserTimelinePage: myMblog,
      getReposts: vi.fn().mockResolvedValue({ ok: 1, data: [], total_number: 0 }),
      searchByDate: vi.fn(),
    },
    favorites: {
      getFavorites: vi.fn().mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } }),
    },
  }
  return { deps, myMblog }
}

async function collect(stream: AsyncIterableIterator<any>) {
  const out: any[] = []
  for await (const item of stream)
    out.push(item)
  return out
}

describe('archiveService incremental', () => {
  it('stops at stopAtMblogId without yielding the boundary item', async () => {
    const { deps } = createDeps([
      mkRaw('P', '2026-10-19T00:00:00+08:00', { isTop: true }),
      mkRaw('A', '2026-10-18T00:00:00+08:00'),
      mkRaw('B', '2026-10-17T00:00:00+08:00'),
      mkRaw('C', '2026-10-16T00:00:00+08:00'),
    ])

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      incremental: { stopAtMblogId: 'B' },
    }))

    expect(items.map(item => item.mblogId)).toEqual(['P', 'A'])
    expect((deps.tweets as any).searchByDate).not.toHaveBeenCalled()
  })

  it('stops when an item is older than incremental.since', async () => {
    const { deps } = createDeps([
      mkRaw('A', '2026-10-18T00:00:00+08:00'),
      mkRaw('B', '2026-10-10T00:00:00+08:00'),
      mkRaw('C', '2026-10-09T00:00:00+08:00'),
    ])

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      incremental: { since: '2026-10-15' },
    }))

    expect(items.map(item => item.mblogId)).toEqual(['A'])
  })

  it('does not use pinned tweets as the time boundary and can skip them', async () => {
    const { deps } = createDeps([
      mkRaw('PIN', '2020-01-01T00:00:00+08:00', { isTop: true }),
      mkRaw('A', '2026-10-18T00:00:00+08:00'),
    ])

    const service = new ArchiveService(deps)
    const kept = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      incremental: { since: '2026-10-15' },
    }))
    expect(kept.map(item => item.mblogId)).toEqual(['PIN', 'A'])

    const skipped = await collect(new ArchiveService(createDeps([
      mkRaw('PIN', '2020-01-01T00:00:00+08:00', { isTop: true }),
      mkRaw('A', '2026-10-18T00:00:00+08:00'),
    ]).deps).streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      incremental: { since: '2026-10-15', skipPinned: true },
    }))
    expect(skipped.map(item => item.mblogId)).toEqual(['A'])
  })

  it('originalOnly skips retweets and disables inline reposts', async () => {
    const { deps } = createDeps([
      mkRaw('A', '2026-10-18T00:00:00+08:00'),
      mkRaw('R', '2026-10-17T00:00:00+08:00', { retweeted_status: mkRaw('ORIG', '2026-10-01T00:00:00+08:00') }),
    ])

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeFavorites: false,
      originalOnly: true,
    }))

    expect(items.map(item => item.mblogId)).toEqual(['A'])
    expect((deps.tweets as any).getReposts).not.toHaveBeenCalled()
  })
})

describe('archiveService multi-account', () => {
  it('streams users sequentially and tags each item with uid', async () => {
    const myMblog = vi.fn(async (uid: string) => mkPage([mkRaw(`T${uid}`)]))
    const deps: ArchiveServiceDeps = {
      tweets: {
        fetchRawUserTimelinePage: myMblog,
        getReposts: vi.fn().mockResolvedValue({ ok: 1, data: [], total_number: 0 }),
      },
      favorites: {
        getFavorites: vi.fn().mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } }),
      },
    }
    const done: Array<[string, number]> = []
    const service = new ArchiveService(deps)

    const out: Array<{ uid: string, id: string }> = []
    for await (const { uid, item } of service.streamUsersArchive(['1', '2'], {
      includeReposts: false,
      includeFavorites: false,
      maxPagesPerPhase: 1,
      onUserDone: (userUid, count) => { done.push([userUid, count]) },
    })) {
      out.push({ uid, id: item.mblogId! })
    }

    expect(out).toEqual([
      { uid: '1', id: 'T1' },
      { uid: '2', id: 'T2' },
    ])
    expect(done).toEqual([['1', 1], ['2', 1]])
  })

  it('skips a failed user when onUserError returns skip', async () => {
    const myMblog = vi.fn(async (uid: string) => {
      if (uid === 'bad')
        throw new Error('boom')
      return mkPage([mkRaw(`T${uid}`)])
    })
    const deps: ArchiveServiceDeps = {
      tweets: {
        fetchRawUserTimelinePage: myMblog,
        getReposts: vi.fn().mockResolvedValue({ ok: 1, data: [], total_number: 0 }),
      },
      favorites: {
        getFavorites: vi.fn().mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } }),
      },
    }

    const service = new ArchiveService(deps)
    const out: string[] = []
    for await (const { item } of service.streamUsersArchive(['bad', 'ok'], {
      includeReposts: false,
      includeFavorites: false,
      onUserError: () => 'skip',
    })) {
      out.push(item.mblogId!)
    }

    expect(out).toEqual(['Tok'])
  })
})
