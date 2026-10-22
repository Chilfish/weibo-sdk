import type { TweetEnrichResult } from '~/services/public/TweetService'
import type { UserArchiveCompletionDeps } from '~/services/public/userArchive/complete'
import type { UserArchiveContentOptions } from '~/types/archive/IUserArchive'
import { makeArchiveComment, makeArchiveTweet } from 'tests/testkit/userArchive'
import { describe, expect, it } from 'vitest'
import { completeUserArchiveTweet } from '~/services/public/userArchive/complete'

const OPTIONS: UserArchiveContentOptions = {
  includeComments: true,
  includeReplies: true,
  includeReposts: true,
  commentOrder: 'time',
}

describe('completeUserArchiveTweet', () => {
  it('startsDetailCommentsAndRepostsBeforeAnyCompletes', async () => {
    const started: string[] = []
    let resolveEnrich!: (value: TweetEnrichResult) => void
    const enrichResult = new Promise<TweetEnrichResult>((resolve) => {
      resolveEnrich = resolve
    })

    const deps: UserArchiveCompletionDeps = {
      enrich: async () => {
        started.push('detail')
        return enrichResult
      },
      async* streamComments() {
        started.push('comments')
        yield* []
      },
      async* streamReplies() {
        yield* []
      },
      async* streamReposts() {
        started.push('reposts')
        yield* []
      },
    }

    const task = completeUserArchiveTweet(deps, makeArchiveTweet('A', undefined, { comments: 1, reposts: 1 }), OPTIONS)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started.sort()).toEqual(['comments', 'detail', 'reposts'])

    resolveEnrich({ tweet: makeArchiveTweet('A') as never, raw: {} as never })
    await task
  })

  it('fetchesNestedRepliesConcurrently', async () => {
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const deps: UserArchiveCompletionDeps = {
      enrich: async () => ({ tweet: makeArchiveTweet('A') as never, raw: {} as never }),
      async* streamComments() {
        yield makeArchiveComment('c1', { totalReplies: 1 })
        yield makeArchiveComment('c2', { totalReplies: 1 })
      },
      async* streamReplies(_mblogId, rootCommentId) {
        started.push(rootCommentId)
        await gate
        yield* []
      },
      async* streamReposts() {
        yield* []
      },
    }

    const task = completeUserArchiveTweet(deps, makeArchiveTweet('A', undefined, { comments: 1 }), {
      ...OPTIONS,
      includeReposts: false,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started.sort()).toEqual(['c1', 'c2'])

    release()
    await task
  })

  it('skipsCommentRequestWhenStatsAreZero', async () => {
    const calls: string[] = []
    const deps: UserArchiveCompletionDeps = {
      enrich: async () => ({ tweet: makeArchiveTweet('A') as never, raw: {} as never }),
      async* streamComments() {
        calls.push('comments')
        yield* []
      },
      async* streamReplies() {
        yield* []
      },
      async* streamReposts() {
        calls.push('reposts')
        yield* []
      },
    }

    await completeUserArchiveTweet(deps, makeArchiveTweet('A'), OPTIONS)
    expect(calls).toEqual([])
  })
})
