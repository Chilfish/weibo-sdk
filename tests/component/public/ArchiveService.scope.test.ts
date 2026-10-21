import type { ArchiveServiceDeps } from '~/services/public/ArchiveService'
import { describe, expect, it, vi } from 'vitest'
import { ArchiveService } from '~/services/public/ArchiveService'

function mkRaw(mblogid: string) {
  return {
    id: 1,
    idstr: mblogid,
    mblogid,
    created_at: 'Mon Oct 19 12:00:00 +0800 2026',
    text: '',
    text_raw: 'hello',
    user: { id: 2, idstr: '2', screen_name: 'u' },
  }
}

function mkPage(items: unknown[]) {
  return { ok: 1, data: { since_id: '', list: items, total: items.length } }
}

function mkRepostPage() {
  return { ok: 1, data: [], total_number: 0, max_page: 1, next_cursor: 0, empty_tip: '' }
}

function createDeps(sessionUid: () => Promise<string | undefined>): {
  deps: ArchiveServiceDeps
  myMblog: ReturnType<typeof vi.fn>
  getFavorites: ReturnType<typeof vi.fn>
  getReposts: ReturnType<typeof vi.fn>
  commentHistory: ReturnType<typeof vi.fn>
} {
  const myMblog = vi.fn((_uid: string, page?: number) =>
    Promise.resolve(page === undefined || page === 1 ? mkPage([mkRaw('A')]) : mkPage([])))
  const getReposts = vi.fn(() => Promise.resolve(mkRepostPage()))
  const getFavorites = vi.fn(() => Promise.resolve({ ok: 1, data: { status: [], total_number: 0 } }))
  const commentHistory = vi.fn(() => Promise.resolve({ ok: 1, data: { comments: [], next_cursor: 0 } }))
  const deps: ArchiveServiceDeps = {
    tweets: { fetchRawUserTimelinePage: myMblog, getReposts },
    favorites: { getFavorites },
    commentHistory: { fetchRawPage: commentHistory },
    sessionUid,
  }
  return { deps, myMblog, getFavorites, getReposts, commentHistory }
}

async function collect(stream: AsyncIterableIterator<any>) {
  const out: any[] = []
  for await (const item of stream)
    out.push(item)
  return out
}

describe('archiveService account-level sources', () => {
  it('rejects includeFavorites when archiving another uid', async () => {
    const { deps, myMblog } = createDeps(() => Promise.resolve('999'))
    const service = new ArchiveService(deps)

    await expect(collect(service.streamArchive('111', { includeFavorites: true })))
      .rejects
      .toMatchObject({
        code: 'CONFIG_INVALID',
        context: { uid: '111', sessionUid: '999', includeFavorites: true },
      })
    expect(myMblog).not.toHaveBeenCalled()
  })

  it('rejects includeCommentHistory when archiving another uid', async () => {
    const { deps } = createDeps(() => Promise.resolve('999'))
    const service = new ArchiveService(deps)

    await expect(collect(service.streamArchive('111', {
      includeFavorites: false,
      includeCommentHistory: true,
    }))).rejects.toMatchObject({ code: 'CONFIG_INVALID', context: { uid: '111' } })
  })

  it('allows account-level sources for the signed-in uid', async () => {
    const { deps, getFavorites } = createDeps(() => Promise.resolve('111'))
    const service = new ArchiveService(deps)

    const items = await collect(service.streamArchive('111', { includeFavorites: true }))

    expect(items.map(item => item.mblogId)).toEqual(['A'])
    expect(getFavorites).toHaveBeenCalledTimes(1)
  })

  it('skips the guard when session uid cannot be resolved', async () => {
    const { deps, getFavorites } = createDeps(() => Promise.resolve(undefined))
    const service = new ArchiveService(deps)

    const items = await collect(service.streamArchive('111', { includeFavorites: true }))

    expect(items.map(item => item.mblogId)).toEqual(['A'])
    expect(getFavorites).toHaveBeenCalledTimes(1)
  })

  it('fails a batch before yielding any item when uids include another account', async () => {
    const sessionUid = vi.fn(() => Promise.resolve('999'))
    const { deps, myMblog } = createDeps(sessionUid)
    const service = new ArchiveService(deps)

    await expect(collect(service.streamUsersArchive(['999', '111'], { includeFavorites: true })))
      .rejects
      .toMatchObject({ code: 'CONFIG_INVALID', context: { uid: '111', sessionUid: '999' } })
    expect(myMblog).not.toHaveBeenCalled()
  })

  it('resolves the session uid once per batch and allows a self-only batch', async () => {
    const sessionUid = vi.fn(() => Promise.resolve('111'))
    const { deps } = createDeps(sessionUid)
    const service = new ArchiveService(deps)

    const items = await collect(service.streamUsersArchive(['111'], { includeFavorites: true }))

    expect(items.map(entry => entry.uid)).toEqual(['111'])
    expect(sessionUid).toHaveBeenCalledTimes(1)
  })
})
