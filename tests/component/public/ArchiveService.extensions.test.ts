import type { ArchiveCheckpoint, ArchiveServiceDeps } from '~/services/public/ArchiveService'
import { describe, expect, it, vi } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { ArchiveService } from '~/services/public/ArchiveService'

function mkRaw(mblogid: string, createdAt = 'now') {
  return {
    id: 1,
    idstr: mblogid,
    mblogid,
    created_at: createdAt,
    text: '',
    text_raw: `text-${mblogid}`,
    user: { id: 2, idstr: '2', screen_name: 'u' },
  }
}

function mkPage(items: unknown[]) {
  return { ok: 1, data: { since_id: '', list: items, total: items.length } }
}

function mkLikePage(items: unknown[]) {
  return { ok: 1, data: { list: items } }
}

function mkComment(id: string, parentMblogId: string) {
  return {
    id,
    idstr: id,
    created_at: 'Mon Oct 19 12:00:00 +0800 2026',
    text: `<b>${id}</b>`,
    text_raw: id,
    source: '来自 北京',
    like_counts: 1,
    user: { id: 9, idstr: '9', screen_name: 'commenter', verified: false, verified_type: 0 },
    status: mkRaw(parentMblogId),
  }
}

function mkCommentsPage(comments: unknown[], nextCursor: number) {
  return {
    ok: 1,
    data: { comments, next_cursor: nextCursor, total_number: comments.length },
  }
}

function createDeps(overrides?: Partial<ArchiveServiceDeps>): {
  deps: ArchiveServiceDeps
  myMblog: ReturnType<typeof vi.fn>
  fetchRawReposts: ReturnType<typeof vi.fn>
  fetchRawFavorites: ReturnType<typeof vi.fn>
  likesFetch: ReturnType<typeof vi.fn>
  commentFetch: ReturnType<typeof vi.fn>
} {
  const myMblog = vi.fn().mockResolvedValue(mkPage([]))
  const fetchRawReposts = vi.fn().mockResolvedValue({ ok: 1, data: [], total_number: 0, max_page: 0, next_cursor: 0, empty_tip: '' })
  const fetchRawFavorites = vi.fn().mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } })
  const likesFetch = vi.fn()
  const commentFetch = vi.fn()
  const deps: ArchiveServiceDeps = {
    tweets: { fetchRawUserTimelinePage: myMblog, fetchRawReposts },
    favorites: { fetchRawFavorites },
    likes: { fetchRawPage: likesFetch },
    commentHistory: { fetchRawPage: commentFetch },
    ...overrides,
  }
  return { deps, myMblog, fetchRawReposts, fetchRawFavorites, likesFetch, commentFetch }
}

async function collect(stream: AsyncIterableIterator<any>) {
  const out: any[] = []
  for await (const item of stream)
    out.push(item)
  return out
}

describe('archiveService D1/D2 sources', () => {
  it('archives liked tweets after timeline with source=like and raw digest', async () => {
    const { deps, likesFetch } = createDeps()
    likesFetch.mockImplementation((_uid: string, page: number) =>
      Promise.resolve(page === 1 ? mkLikePage([mkRaw('L1'), mkRaw('L2')]) : mkLikePage([])),
    )
    const onRaw = vi.fn()

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      includeLikes: true,
      onRaw,
    }))

    expect(items.map(i => i.source)).toEqual(['like', 'like'])
    expect(items.map(i => i.mblogId)).toEqual(['L1', 'L2'])
    expect(items[0].checkpoint).toMatchObject({ phase: 'likes', likesPage: 1 })
    // schemaDigest 是 raw 结构快照（值会被脱敏），只断言键存在
    expect(items[0].schemaDigest).toHaveProperty('mblogid')
    expect(items[0].tweet.text).toBe('text-L1')
    expect(onRaw).toHaveBeenCalledWith(expect.objectContaining({ mblogid: 'L1' }), {
      uid: '111',
      source: 'like',
      mblogId: 'L1',
      page: 1,
    })
  })

  it('archives comment history with the comment attached to the parent tweet', async () => {
    const { deps, commentFetch } = createDeps()
    commentFetch.mockImplementation((options: { maxId?: number }) => {
      if (options.maxId === undefined)
        return Promise.resolve(mkCommentsPage([mkComment('C1', 'P1'), mkComment('C2', 'P2')], 9999))
      if (options.maxId === 9999)
        return Promise.resolve(mkCommentsPage([mkComment('C3', 'P3')], 0))
      return Promise.resolve(mkCommentsPage([], 0))
    })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      includeCommentHistory: true,
    }))

    expect(items.map(i => i.source)).toEqual(['comment', 'comment', 'comment'])
    expect(items.map(i => i.mblogId)).toEqual(['P1', 'P2', 'P3'])
    expect(items.map(i => i.comment.id)).toEqual(['C1', 'C2', 'C3'])
    expect(items[0].comment.text).toBe('C1')
    expect(items[0].tweet.mblogId).toBe('P1')
    // 第一页 checkpoint 不带游标（首屏），第二页记录进入该页的 max_id
    expect(items[0].checkpoint.commentHistoryCursor).toBeUndefined()
    expect(items[2].checkpoint.commentHistoryCursor).toBe(9999)
    // 游标到 0 后停止（没有额外请求）
    expect(commentFetch).toHaveBeenCalledTimes(2)
  })

  it('runs timeline → likes → comments → favorites in order', async () => {
    const { deps, myMblog, likesFetch, commentFetch, fetchRawFavorites } = createDeps()
    myMblog.mockImplementation((_uid: string, page?: number) =>
      Promise.resolve(page === 1 || page === undefined ? mkPage([mkRaw('T1')]) : mkPage([])),
    )
    likesFetch.mockImplementation((_uid: string, page: number) =>
      Promise.resolve(page === 1 ? mkLikePage([mkRaw('L1')]) : mkLikePage([])),
    )
    commentFetch.mockResolvedValue(mkCommentsPage([mkComment('C1', 'P1')], 0))
    fetchRawFavorites.mockResolvedValue({ ok: 1, data: { status: [mkRaw('F1')], total_number: 1 } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeLikes: true,
      includeCommentHistory: true,
      includeFavorites: true,
    }))

    expect(items.map(i => i.source)).toEqual(['timeline', 'like', 'comment', 'favorite'])
    expect(items.map(i => i.mblogId)).toEqual(['T1', 'L1', 'P1', 'F1'])
  })

  it('requires deps.likes when includeLikes is true', async () => {
    const { deps } = createDeps({ likes: undefined })
    const service = new ArchiveService(deps)

    await expect(service.streamArchive('111', { includeLikes: true }).next())
      .rejects
      .toBeInstanceOf(InvalidConfigError)
  })

  it('requires deps.commentHistory when includeCommentHistory is true', async () => {
    const { deps } = createDeps({ commentHistory: undefined })
    const service = new ArchiveService(deps)

    await expect(service.streamArchive('111', { includeCommentHistory: true }).next())
      .rejects
      .toBeInstanceOf(InvalidConfigError)
  })

  it('resumes from a likes checkpoint without replaying timeline', async () => {
    const { deps, myMblog, likesFetch } = createDeps()
    likesFetch.mockImplementation((_uid: string, page: number) =>
      Promise.resolve(page === 2 ? mkLikePage([mkRaw('L2')]) : mkLikePage([])),
    )
    const checkpoint: ArchiveCheckpoint = { uid: '111', phase: 'likes', likesPage: 2 }

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      includeLikes: true,
      checkpoint,
    }))

    expect(myMblog).not.toHaveBeenCalled()
    expect(items.map(i => i.mblogId)).toEqual(['L2'])
    expect(items[0].checkpoint).toMatchObject({ phase: 'likes', likesPage: 2 })
    expect(likesFetch.mock.calls.map(call => call[1])).toEqual([2, 3])
  })

  it('resumes from a comments checkpoint using the stored cursor', async () => {
    const { deps, myMblog, commentFetch } = createDeps()
    commentFetch.mockResolvedValue(mkCommentsPage([mkComment('C3', 'P3')], 0))
    const checkpoint: ArchiveCheckpoint = { uid: '111', phase: 'comments', commentHistoryCursor: 9999 }

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      includeCommentHistory: true,
      checkpoint,
    }))

    expect(myMblog).not.toHaveBeenCalled()
    expect(commentFetch).toHaveBeenCalledWith({ maxId: 9999 })
    expect(items.map(i => i.comment.id)).toEqual(['C3'])
    expect(items[0].checkpoint.commentHistoryCursor).toBe(9999)
  })

  it('finishes as done when resuming a favorites checkpoint with favorites disabled', async () => {
    const { deps, myMblog, fetchRawFavorites } = createDeps()
    const phases: string[] = []
    const checkpoint: ArchiveCheckpoint = { uid: '111', phase: 'favorites', favoritesPage: 2 }

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeFavorites: false,
      checkpoint,
      onProgress: (progress) => { phases.push(progress.phase) },
    }))

    expect(items).toEqual([])
    expect(myMblog).not.toHaveBeenCalled()
    expect(fetchRawFavorites).not.toHaveBeenCalled()
    expect(phases).toContain('done')
  })

  it('keeps checkpoints constant-size and phase-specific', async () => {
    const { deps, myMblog, likesFetch, commentFetch } = createDeps()
    myMblog.mockImplementation((_uid: string, page?: number) =>
      Promise.resolve(page === 1 || page === undefined ? mkPage([mkRaw('T1')]) : mkPage([])),
    )
    likesFetch.mockImplementation((_uid: string, page: number) =>
      Promise.resolve(page === 1 ? mkLikePage([mkRaw('L1')]) : mkLikePage([])),
    )
    commentFetch.mockResolvedValue(mkCommentsPage([mkComment('C1', 'P1')], 0))

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      includeLikes: true,
      includeCommentHistory: true,
    }))

    const timeline = items.find(i => i.source === 'timeline')
    const like = items.find(i => i.source === 'like')
    const comment = items.find(i => i.source === 'comment')

    expect(Object.keys(timeline.checkpoint).sort()).toEqual([
      'favoritesPage',
      'lastTimelineMblogId',
      'page',
      'phase',
      'uid',
    ])
    expect(like.checkpoint).toMatchObject({ phase: 'likes', likesPage: 1 })
    expect('commentHistoryCursor' in like.checkpoint).toBe(false)
    expect(comment.checkpoint).toMatchObject({ phase: 'comments' })
    expect('likesPage' in comment.checkpoint).toBe(false)
    expect('visitedMblogIds' in comment.checkpoint).toBe(false)
  })
})
