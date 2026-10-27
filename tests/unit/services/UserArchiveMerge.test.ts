import type { ArchivedTweet, ArchiveFile } from '~/types/archive/IArchiveFile'
import type { ITweet, ITweetComment } from '~/types/domain/ITweet'
import { makeArchiveComment, makeArchiveTweet, makeArchiveUser } from 'tests/testkit/userArchive'
import { describe, expect, it } from 'vitest'
import { mergeArchiveFiles } from '~/services/public/userArchive/merge'
import { ARCHIVE_SCHEMA_ID, ARCHIVE_SCHEMA_URL } from '~/types/archive/IArchiveFile'
import { MediaType } from '~/types/domain/ITweet'

const UID = '1234567890'
const JAN_RANGE = {
  since: { input: '2025-01-01', unix: 1735689600, iso: '2025-01-01T00:00:00.000Z' },
  until: { input: '2025-01-31', unix: 1738368000, iso: '2025-01-31T00:00:00.000Z' },
}

function media(count: number): ITweet['media'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    type: MediaType.PIC,
    imageUrl: '',
    width: 1,
    height: 1,
  }))
}

function record(
  mblogId: string,
  options: {
    createdAt?: string
    comments?: ITweetComment[]
    reposts?: ITweet[]
    mediaCount?: number
    text?: string
  } = {},
): ArchivedTweet {
  const tweet = makeArchiveTweet(mblogId, options.createdAt)
  if (options.mediaCount !== undefined)
    tweet.media = media(options.mediaCount)
  if (options.text !== undefined)
    tweet.text = options.text

  return {
    mblogId,
    source: 'timeline',
    tweet,
    comments: options.comments ?? [],
    ...(options.reposts === undefined ? {} : { reposts: options.reposts }),
  }
}

function archive(overrides: Partial<ArchiveFile> = {}): ArchiveFile {
  const tweets = overrides.tweets ?? []
  return {
    $schema: ARCHIVE_SCHEMA_URL,
    schema: ARCHIVE_SCHEMA_ID,
    generatedAt: '2025-02-01T00:00:00.000Z',
    complete: true,
    query: {
      uid: UID,
      range: JAN_RANGE,
      includeComments: true,
      includeReplies: true,
      includeReposts: false,
      commentOrder: 'time',
    },
    user: makeArchiveUser(UID),
    stats: { tweets: tweets.length, comments: 0, replies: 0, errors: 0 },
    tweets,
    errors: [],
    ...overrides,
  }
}

function withoutGeneratedAt(file: ArchiveFile): ArchiveFile {
  const { generatedAt: _, ...rest } = file
  return rest as ArchiveFile
}

describe('mergeArchiveFiles', () => {
  it('mergesDisjointTweetsAndSortsDescending', () => {
    const older = archive({
      generatedAt: '2025-02-01T00:00:00.000Z',
      tweets: [
        record('A', { createdAt: '2025-01-01T00:00:00.000Z' }),
        record('B', { createdAt: '2025-01-20T00:00:00.000Z' }),
      ],
    })
    const newer = archive({
      generatedAt: '2025-03-01T00:00:00.000Z',
      tweets: [record('C', { createdAt: '2025-02-10T00:00:00.000Z' })],
    })

    const result = mergeArchiveFiles([older, newer], { now: new Date('2025-04-01T00:00:00.000Z') })

    expect(result.file.tweets.map(tweet => tweet.mblogId)).toEqual(['C', 'B', 'A'])
    expect(result).toMatchObject({ inputs: 2, inputTweets: 3, tweets: 3, deduped: 0 })
    expect(result.file.generatedAt).toBe('2025-04-01T00:00:00.000Z')
    expect(result.file.schema).toBe(ARCHIVE_SCHEMA_ID)
  })

  it('unionsCommentsAndRepliesForSameTweet', () => {
    const older = archive({
      tweets: [
        record('A', {
          comments: [
            makeArchiveComment('c1', {
              replies: [makeArchiveComment('r1')],
              totalReplies: 1,
            }),
          ],
        }),
      ],
    })
    const newer = archive({
      generatedAt: '2025-03-01T00:00:00.000Z',
      tweets: [
        record('A', {
          comments: [
            makeArchiveComment('c1', {
              replies: [makeArchiveComment('r2')],
              totalReplies: 2,
            }),
            makeArchiveComment('c2'),
          ],
        }),
      ],
    })

    const { file, ...counts } = mergeArchiveFiles([older, newer])

    expect(file.tweets).toHaveLength(1)
    const comments = file.tweets[0].comments
    expect(comments.map(comment => comment.id)).toEqual(['c1', 'c2'])
    expect(comments[0].replies?.map(reply => reply.id)).toEqual(['r2', 'r1'])
    expect(comments[0].totalReplies).toBe(2)
    expect(file.stats).toEqual({ tweets: 1, comments: 2, replies: 2, errors: 0 })
    expect(counts.deduped).toBe(1)
  })

  it('prefersRicherTweetBody', () => {
    const stub = archive({
      tweets: [record('A', { mediaCount: 1, text: 'short' })],
    })
    const detail = archive({
      generatedAt: '2025-03-01T00:00:00.000Z',
      tweets: [record('A', { mediaCount: 3, text: 'a much longer body' })],
    })

    const { file } = mergeArchiveFiles([stub, detail])

    expect(file.tweets[0].tweet.media).toHaveLength(3)
    expect(file.tweets[0].tweet.text).toBe('a much longer body')
  })

  it('unionsRepostsByMblogId', () => {
    const older = archive({
      tweets: [record('A', { reposts: [makeArchiveTweet('r1'), makeArchiveTweet('r2')] })],
    })
    const newer = archive({
      generatedAt: '2025-03-01T00:00:00.000Z',
      query: {
        uid: UID,
        range: JAN_RANGE,
        includeComments: true,
        includeReplies: true,
        includeReposts: true,
        commentOrder: 'time',
      },
      tweets: [record('A', { reposts: [makeArchiveTweet('r2'), makeArchiveTweet('r3')] })],
    })

    const { file } = mergeArchiveFiles([older, newer])

    expect(file.tweets[0].reposts?.map(repost => repost.mblogId)).toEqual(['r2', 'r3', 'r1'])
    expect(file.query.includeReposts).toBe(false)
  })

  it('dropsIssuesResolvedByAnotherArchive', () => {
    const resolved = archive({
      tweets: [record('A')],
    })
    const failed = archive({
      generatedAt: '2025-03-01T00:00:00.000Z',
      complete: false,
      tweets: [record('A')],
      errors: [{ stage: 'detail', mblogId: 'A', code: 'API_NOT_OK', message: 'boom' }],
    })

    const { file } = mergeArchiveFiles([resolved, failed])

    expect(file.errors).toEqual([])
    expect(file.complete).toBe(true)
  })

  it('keepsIssuesThatNoArchiveCovered', () => {
    const older = archive({ tweets: [record('A')] })
    const newer = archive({
      generatedAt: '2025-03-01T00:00:00.000Z',
      complete: false,
      tweets: [record('A')],
      errors: [{ stage: 'timeline', mblogId: 'Z', code: 'API_NOT_OK', message: 'gone' }],
    })

    const { file } = mergeArchiveFiles([older, newer])

    expect(file.errors).toHaveLength(1)
    expect(file.complete).toBe(false)
    expect(file.stats.errors).toBe(1)
  })

  it('usesRangeEnvelopeAndContentIntersection', () => {
    const march = {
      since: { input: '2025-03-01', unix: 1740787200, iso: '2025-03-01T00:00:00.000Z' },
      until: { input: '2025-03-31', unix: 1743379200, iso: '2025-03-31T00:00:00.000Z' },
    }
    const older = archive({
      query: {
        uid: UID,
        range: JAN_RANGE,
        includeComments: true,
        includeReplies: true,
        includeReposts: false,
        commentOrder: 'time',
      },
    })
    const newer = archive({
      generatedAt: '2025-03-01T00:00:00.000Z',
      query: {
        uid: UID,
        range: march,
        includeComments: false,
        includeReplies: true,
        includeReposts: true,
        commentOrder: 'hot',
      },
    })

    const { file } = mergeArchiveFiles([older, newer])

    expect(file.query.range.since.input).toBe('2025-01-01')
    expect(file.query.range.until.input).toBe('2025-03-31')
    expect(file.query.includeComments).toBe(false)
    expect(file.query.includeReposts).toBe(false)
    expect(file.query.commentOrder).toBe('hot')
    expect('estimatedTotal' in file.query).toBe(false)
    expect(file.user).toEqual(newer.user)
  })

  it('isIdempotentAndOrderIndependent', () => {
    const a = archive({
      tweets: [
        record('A', { comments: [makeArchiveComment('c1')], mediaCount: 1 }),
        record('B', { createdAt: '2025-01-02T00:00:00.000Z' }),
      ],
    })
    const b = archive({
      generatedAt: '2025-03-01T00:00:00.000Z',
      tweets: [
        record('A', { comments: [makeArchiveComment('c1'), makeArchiveComment('c2')], mediaCount: 2 }),
      ],
    })

    const first = mergeArchiveFiles([a, b], { now: new Date('2025-04-01T00:00:00.000Z') }).file
    const again = mergeArchiveFiles([first, b], { now: new Date('2025-05-01T00:00:00.000Z') }).file
    const reversed = mergeArchiveFiles([b, a], { now: new Date('2025-04-01T00:00:00.000Z') }).file

    expect(withoutGeneratedAt(again)).toEqual(withoutGeneratedAt(first))
    expect(withoutGeneratedAt(reversed)).toEqual(withoutGeneratedAt(first))
  })

  it('rejectsMixedAccounts', () => {
    const other = archive({
      query: {
        uid: '999',
        range: JAN_RANGE,
        includeComments: true,
        includeReplies: true,
        includeReposts: false,
        commentOrder: 'time',
      },
      user: makeArchiveUser('999'),
    })

    expect(() => mergeArchiveFiles([archive(), other])).toThrowError(/different accounts/)
  })

  it('rejectsNonArchiveInput', () => {
    const notArchive = { tweets: [] } as unknown as ArchiveFile

    expect(() => mergeArchiveFiles([notArchive])).toThrowError(/weibo-user-archive\/v3/)
    expect(() => mergeArchiveFiles([])).toThrowError(/At least one archive/)
  })

  it('migrates v2 archives into v3 records', () => {
    const legacy = archive({
      $schema: 'https://weibo-sdk.chilfish.top/schemas/weibo-user-archive/v2.json',
      schema: 'weibo-user-archive/v2',
      tweets: [{
        ...record('A'),
        tweet: {
          ...makeArchiveTweet('A'),
          readCount: 12,
          playCount: 34,
          isTop: true,
          isOriginal: true,
        } as unknown as ITweet,
      }],
    })

    const { file } = mergeArchiveFiles([legacy])

    expect(file.schema).toBe(ARCHIVE_SCHEMA_ID)
    expect(file.tweets[0].tweet.stats).toEqual(expect.objectContaining({ reads: 12, plays: 34 }))
    expect(file.tweets[0].tweet.flags).toEqual({ pinned: true, original: true })
    expect(file.tweets[0].tweet).not.toHaveProperty('readCount')
  })
})
