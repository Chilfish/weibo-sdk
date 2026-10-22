import type { JournalTweetEntry, RunConfig } from '../../../../scripts/archive-user/types'
import type { ArchivedTweet, ArchiveIssue } from '../../../../src/types/archive/IArchiveFile'
import type { ITweet, ITweetComment } from '../../../../src/types/domain/ITweet'
import type { IUser } from '../../../../src/types/domain/IUser'
import { describe, expect, it } from 'vitest'
import { assembleArchive } from '../../../../scripts/archive-user/output'

const config: RunConfig = {
  uid: '1',
  range: {
    since: { input: '2025-01-01', unix: 1 },
    until: { input: '2025-01-31', unix: 2 },
  },
  sliceDays: 0,
  options: {
    includeComments: true,
    includeReplies: true,
    includeReposts: false,
    commentOrder: 'time',
  },
}

const user = {
  id: '1',
  name: 'tester',
  stats: { statuses: 1 },
} as IUser

function makeTweet(mblogId: string, createdAt: string): ITweet {
  return {
    id: mblogId,
    mblogId,
    createdAt,
    text: '',
    source: '微博网页版',
    user: {} as ITweet['user'],
    stats: { likes: 0, comments: 0, reposts: 0 },
    visible: {} as ITweet['visible'],
    media: [],
  }
}

function makeRecord(mblogId: string, createdAt = '2025-01-01T00:00:00.000Z'): ArchivedTweet {
  return {
    mblogId,
    source: 'timeline',
    tweet: makeTweet(mblogId, createdAt),
    comments: [],
  }
}

function makeEntry(
  mblogId: string,
  options: { createdAt?: string, issues?: ArchiveIssue[], comments?: ITweetComment[] } = {},
): JournalTweetEntry {
  return {
    type: 'tweet',
    slice: 's000',
    mblogId,
    record: {
      ...makeRecord(mblogId, options.createdAt),
      comments: options.comments ?? [],
    },
    issues: options.issues ?? [],
  }
}

function makeComment(id: string, replies = 0): ITweetComment {
  return {
    id,
    createdAt: '2025-01-01T00:00:00.000Z',
    text: '',
    source: '微博网页版',
    likes: 0,
    user: {} as ITweetComment['user'],
    ...(replies === 0 ? {} : { replies: Array.from({ length: replies }, (_, index) => makeComment(`${id}-${index}`)) }),
  }
}

describe('assembleArchive', () => {
  it('dedupesByMblogIdAndEstimatesStats', () => {
    const noisy = makeEntry('A', { issues: [{ stage: 'detail', code: 'X', message: 'x' }] })
    const clean = makeEntry('A', { comments: [makeComment('c1', 2)] })
    const other = makeEntry('B', { comments: [makeComment('c2')] })

    const { output, errors, complete } = assembleArchive({
      uid: '1',
      config,
      user,
      entries: [noisy, clean, other],
      issues: [],
    })

    expect(output.stats).toEqual({ tweets: 2, comments: 2, replies: 2, errors: 0 })
    expect(output.tweets.map(tweet => tweet.mblogId).sort()).toEqual(['A', 'B'])
    expect(errors).toEqual([])
    expect(complete).toBe(true)
  })

  it('sortsTweetsByCreatedAtDescending', () => {
    const { output } = assembleArchive({
      uid: '1',
      config,
      user,
      entries: [
        makeEntry('old', { createdAt: '2024-01-01T00:00:00.000Z' }),
        makeEntry('new', { createdAt: '2025-06-01T00:00:00.000Z' }),
        makeEntry('mid', { createdAt: '2024-06-01T00:00:00.000Z' }),
      ],
      issues: [],
    })

    expect(output.tweets.map(tweet => tweet.mblogId)).toEqual(['new', 'mid', 'old'])
  })

  it('collectsAndDedupesIssuesFromEntriesAndEnumeration', () => {
    const shared: ArchiveIssue = { stage: 'comments', code: 'UNKNOWN', message: 'boom', mblogId: 'A' }
    const extra: ArchiveIssue = { stage: 'timeline', code: 'UNKNOWN', message: 'enum' }

    const { output, errors, complete } = assembleArchive({
      uid: '1',
      config,
      user,
      entries: [makeEntry('A', { issues: [shared] })],
      issues: [shared, extra],
    })

    expect(errors).toEqual([shared, extra])
    expect(output.stats.errors).toBe(2)
    expect(complete).toBe(false)
  })

  it('fatalError_isAddedAsTimelineIssueAndMarksIncomplete', () => {
    const { output, errors, complete } = assembleArchive({
      uid: '1',
      config,
      user,
      entries: [],
      issues: [],
      fatalError: new Error('auth gone'),
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ stage: 'timeline', code: 'UNKNOWN', message: 'auth gone' })
    expect(output.complete).toBe(false)
    expect(complete).toBe(false)
  })

  it('stripsLegacyRawFromRecords', () => {
    const entry = makeEntry('A')
    entry.record = { ...entry.record, raw: { huge: true } } as ArchivedTweet

    const { output } = assembleArchive({
      uid: '1',
      config,
      user,
      entries: [entry],
      issues: [],
    })

    expect('raw' in output.tweets[0]).toBe(false)
  })

  it('writesQueryFromConfig', () => {
    const { output } = assembleArchive({ uid: '1', config, user, entries: [], issues: [] })
    expect(output.query).toMatchObject({
      uid: '1',
      includeComments: true,
      includeReplies: true,
      includeReposts: false,
      commentOrder: 'time',
    })
    expect(output.query.range.since.iso).toBe(new Date(1000).toISOString())
  })
})
