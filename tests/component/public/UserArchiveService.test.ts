import type { ArchiveStreamOptions } from '~/services/public/ArchiveService'
import type { UserArchiveServiceDeps } from '~/services/public/UserArchiveService'
import type { UserArchiveProgress } from '~/types/archive/IUserArchive'
import type { ITweet, ITweetComment } from '~/types/domain/ITweet'
import {
  makeArchiveCheckpoint,
  makeArchiveComment,
  makeArchiveItem,
  makeArchiveTweet,
  makeArchiveUser,
} from 'tests/testkit/userArchive'
import { describe, expect, it } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { createMemoryUserArchiveStore } from '~/services/public/userArchive/memoryStore'
import { UserArchiveService } from '~/services/public/UserArchiveService'

const UID = '1234567890'
const OPTIONS = { since: '2025-01-01', until: '2025-01-31', sliceDays: 0 } as const

interface FakeOptions {
  tweets?: ITweet[]
  comments?: Record<string, ITweetComment[]>
  replies?: Record<string, ITweetComment[]>
  reposts?: Record<string, ITweet[]>
  enrichError?: unknown
  streamError?: unknown
  authMode?: 'cookie' | 'guest'
  /** 模拟 searchProfile 返回的总数。 */
  total?: number
}

function createFakeDeps(overrides: FakeOptions = {}) {
  const tweets = (overrides.tweets ?? [makeArchiveTweet('A')]).map(tweet => ({
    ...tweet,
    stats: {
      ...tweet.stats,
      comments: tweet.stats.comments || (overrides.comments?.[tweet.mblogId]?.length ? 1 : 0),
      reposts: tweet.stats.reposts || (overrides.reposts?.[tweet.mblogId]?.length ? 1 : 0),
    },
  }))
  const calls = {
    stream: [] as ArchiveStreamOptions[],
    enrich: [] as string[],
    comments: [] as string[],
    replies: [] as string[],
    reposts: [] as string[],
  }

  const deps: UserArchiveServiceDeps = {
    async* streamArchive(uid, options) {
      calls.stream.push(options)
      if (overrides.streamError !== undefined)
        throw overrides.streamError
      if (overrides.total !== undefined) {
        await options.onProgress?.({
          uid,
          phase: 'timeline',
          processed: 0,
          source: 'search',
          page: 1,
          total: overrides.total,
          remaining: 0,
        })
      }
      for (const tweet of tweets) {
        yield makeArchiveItem(tweet, makeArchiveCheckpoint(uid, {
          sliceEnd: options.until,
          slicePage: 1,
          sliceWindow: 100,
        }))
      }
    },
    async enrich(mblogId) {
      calls.enrich.push(mblogId)
      if (overrides.enrichError !== undefined)
        throw overrides.enrichError
      const tweet = tweets.find(item => item.mblogId === mblogId) ?? makeArchiveTweet(mblogId)
      return { tweet: tweet as never, raw: {} as never }
    },
    async* streamComments(mblogId) {
      calls.comments.push(mblogId)
      for (const comment of overrides.comments?.[mblogId] ?? [])
        yield comment
    },
    async* streamReplies(_mblogId, rootCommentId) {
      calls.replies.push(rootCommentId)
      for (const reply of overrides.replies?.[rootCommentId] ?? [])
        yield reply
    },
    async* streamReposts(mblogId) {
      calls.reposts.push(mblogId)
      for (const repost of overrides.reposts?.[mblogId] ?? [])
        yield repost
    },
    async getUser() {
      return makeArchiveUser(UID)
    },
    authMode: overrides.authMode ?? 'cookie',
  }

  return { deps, calls }
}

describe('userArchiveService', () => {
  it('run_completesDetailCommentsRepliesAndReposts', async () => {
    const inlineReply = makeArchiveComment('r1')
    const fetchedReply = makeArchiveComment('r2')
    const { deps, calls } = createFakeDeps({
      tweets: [makeArchiveTweet('A'), makeArchiveTweet('B')],
      comments: {
        A: [makeArchiveComment('c1', { replies: [inlineReply], totalReplies: 2 })],
      },
      replies: { c1: [inlineReply, fetchedReply] },
      reposts: { A: [makeArchiveTweet('R')] },
    })

    const service = new UserArchiveService(deps)
    const result = await service.run(UID, { ...OPTIONS, includeReposts: true })

    expect(result.complete).toBe(true)
    expect(result.file.tweets).toHaveLength(2)
    expect(result.file.tweets[0].comments[0].replies?.map(reply => reply.id)).toEqual(['r1', 'r2'])
    expect(result.file.tweets[0].reposts?.map(repost => repost.mblogId)).toEqual(['R'])
    expect(result.summary).toMatchObject({ tweets: 2, comments: 1, replies: 2, errors: 0 })
    expect(calls.enrich).toEqual(['A', 'B'])
    expect(calls.replies).toEqual(['c1'])
    expect(calls.reposts).toEqual(['A'])
  })

  it('run_reportsEstimatedTotalAndCoverage', async () => {
    const { deps } = createFakeDeps({
      tweets: [makeArchiveTweet('A'), makeArchiveTweet('B')],
      total: 10,
    })
    const progress: UserArchiveProgress[] = []

    const result = await new UserArchiveService(deps).run(UID, {
      ...OPTIONS,
      onProgress: (item) => { progress.push(item) },
    })

    expect(result.summary).toMatchObject({ tweets: 2, estimatedTotal: 10, coverage: 0.2 })
    expect(progress.some(item => item.overallTotal === 10)).toBe(true)
  })

  it('run_skipsCommentsWhenDisabled', async () => {
    const { deps, calls } = createFakeDeps({
      comments: { A: [makeArchiveComment('c1')] },
    })

    const result = await new UserArchiveService(deps).run(UID, {
      ...OPTIONS,
      includeComments: false,
      includeReplies: false,
    })

    expect(result.file.tweets[0].comments).toEqual([])
    expect(calls.comments).toEqual([])
    expect(calls.replies).toEqual([])
  })

  it('run_doesNotExpandRepliesWhenDisabled', async () => {
    const { deps, calls } = createFakeDeps({
      comments: {
        A: [makeArchiveComment('c1', { replies: [makeArchiveComment('r1')], totalReplies: 1 })],
      },
      replies: { c1: [makeArchiveComment('r2')] },
    })

    const result = await new UserArchiveService(deps).run(UID, {
      ...OPTIONS,
      includeReplies: false,
    })

    expect(result.file.tweets[0].comments[0].replies?.map(reply => reply.id)).toEqual(['r1'])
    expect(calls.replies).toEqual([])
  })

  it('run_recordsDetailFailureAsIssue', async () => {
    const { deps } = createFakeDeps({ enrichError: new Error('boom') })

    const result = await new UserArchiveService(deps).run(UID, OPTIONS)

    expect(result.complete).toBe(false)
    expect(result.file.errors).toHaveLength(1)
    expect(result.file.errors[0]).toMatchObject({ stage: 'detail', code: 'UNKNOWN', message: 'boom', mblogId: 'A' })
    // 详情失败时仍保留时间线里的简版微博。
    expect(result.file.tweets).toHaveLength(1)
  })

  it('run_fatalStreamErrorStopsAndMarksIncomplete', async () => {
    const { deps, calls } = createFakeDeps({
      streamError: new InvalidConfigError('blocked', { field: 'test' }),
    })

    const result = await new UserArchiveService(deps).run(UID, OPTIONS)

    expect(result.complete).toBe(false)
    expect(result.file.errors[0]).toMatchObject({ stage: 'timeline', code: 'CONFIG_INVALID' })
    expect(calls.stream).toHaveLength(1)
  })

  it('run_resumeSkipsDoneSliceAndKeepsRecords', async () => {
    const store = createMemoryUserArchiveStore()
    const first = createFakeDeps()

    const firstResult = await new UserArchiveService(first.deps).run(UID, { ...OPTIONS, store })
    expect(firstResult.complete).toBe(true)
    expect(first.calls.stream).toHaveLength(1)

    const second = createFakeDeps({ streamError: new Error('should not be called') })
    const secondResult = await new UserArchiveService(second.deps).run(UID, { ...OPTIONS, store })

    expect(secondResult.complete).toBe(true)
    expect(secondResult.file.tweets).toHaveLength(1)
    expect(second.calls.stream).toEqual([])
  })

  it('run_resumeWithoutExplicitOptionsInheritsJournalConfig', async () => {
    const store = createMemoryUserArchiveStore()
    const first = createFakeDeps()

    await new UserArchiveService(first.deps).run(UID, {
      ...OPTIONS,
      includeComments: false,
      includeReplies: false,
      commentOrder: 'hot',
      store,
    })

    const second = createFakeDeps({ streamError: new Error('should not be called') })
    const result = await new UserArchiveService(second.deps).run(UID, { store })

    expect(result.complete).toBe(true)
    expect(result.file.query).toMatchObject({
      includeComments: false,
      includeReplies: false,
      commentOrder: 'hot',
    })
    expect(second.calls.stream).toEqual([])
  })

  it('run_resumeConfigMismatchThrows', async () => {
    const store = createMemoryUserArchiveStore()
    const { deps } = createFakeDeps()
    await new UserArchiveService(deps).run(UID, { ...OPTIONS, store })

    await expect(new UserArchiveService(deps).run(UID, {
      since: '2025-01-01',
      until: '2025-02-28',
      sliceDays: 0,
      store,
    })).rejects.toMatchObject({ code: 'RESUME_MISMATCH', context: { field: 'resume', mismatch: 'until' } })
  })

  it('run_mergeResumeKeepsRecordsAndReplansRange', async () => {
    const store = createMemoryUserArchiveStore()
    const first = createFakeDeps({ tweets: [makeArchiveTweet('A', '2025-01-15T00:00:00.000Z')] })
    const firstResult = await new UserArchiveService(first.deps).run(UID, { ...OPTIONS, store })
    expect(firstResult.complete).toBe(true)

    const second = createFakeDeps({ tweets: [makeArchiveTweet('B', '2025-02-15T00:00:00.000Z')] })
    const result = await new UserArchiveService(second.deps).run(UID, {
      since: '2025-02-01',
      until: '2025-02-28',
      sliceDays: 0,
      resume: 'merge',
      store,
    })

    expect(result.complete).toBe(true)
    expect(result.file.tweets.map(tweet => tweet.mblogId).sort()).toEqual(['A', 'B'])
    expect(result.summary).toMatchObject({ tweets: 2, errors: 0 })

    const meta = await store.loadMeta()
    expect(meta?.config.range.since.input).toBe('2025-02-01')
    expect(meta?.slices[0]).toMatchObject({ since: second.calls.stream[0].since, until: second.calls.stream[0].until })
    // 旧记录保留，但不再补全；只补新范围内缺失的 B。
    expect(second.calls.enrich).toEqual(['B'])
  })

  it('run_mergeResumeStillRejectsAnotherUid', async () => {
    const store = createMemoryUserArchiveStore()
    const { deps } = createFakeDeps()
    await new UserArchiveService(deps).run(UID, { ...OPTIONS, store })

    await expect(new UserArchiveService(deps).run('999', { resume: 'merge', store }))
      .rejects
      .toMatchObject({ code: 'RESUME_MISMATCH', context: { mismatch: 'uid' } })
  })

  it('run_guestModeThrowsConfigInvalid', async () => {
    const { deps } = createFakeDeps({ authMode: 'guest' })
    await expect(new UserArchiveService(deps).run(UID, OPTIONS)).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })

  it('run_abortedSignalMarksIncomplete', async () => {
    const { deps, calls } = createFakeDeps()
    const controller = new AbortController()
    controller.abort()

    const result = await new UserArchiveService(deps).run(UID, {
      ...OPTIONS,
      signal: controller.signal,
    })

    expect(calls.stream).toEqual([])
    expect(result.complete).toBe(false)
    expect(result.file.errors[0]).toMatchObject({ code: 'ABORTED' })
  })

  it('stream_emitsMetaRecordsAndDone', async () => {
    const { deps } = createFakeDeps()
    const events: string[] = []
    const slices: string[] = []

    for await (const event of new UserArchiveService(deps).stream(UID, OPTIONS)) {
      events.push(event.type)
      if (event.type === 'record')
        slices.push(event.entry.slice)
      if (event.type === 'done')
        expect(event.summary.complete).toBe(true)
    }

    expect(events).toEqual(['meta', 'slice-start', 'record', 'slice-done', 'done'])
    expect(slices).toHaveLength(1)
    expect(slices[0]).toMatch(/^s000-/)
  })
})
