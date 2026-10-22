import type { UserArchiveMeta, UserArchiveRecord, UserArchiveRunConfig } from '~/types/archive/IUserArchive'
import { makeArchiveComment, makeArchiveUser } from 'tests/testkit/userArchive'
import { describe, expect, it } from 'vitest'
import { assembleUserArchive, dedupeUserArchiveRecords } from '~/services/public/userArchive/assemble'
import { buildUserArchiveConfig } from '~/services/public/userArchive/config'

const UID = '1234567890'

function makeConfig(overrides: { includeReposts?: boolean } = {}): UserArchiveRunConfig {
  return buildUserArchiveConfig(UID, {
    since: '2025-01-01',
    until: '2025-01-31',
    sliceDays: 0,
    ...overrides,
  })
}

function makeMeta(config = makeConfig()): UserArchiveMeta {
  return {
    type: 'meta',
    schema: 'weibo-user-archive-journal/v2',
    createdAt: '2025-02-01T00:00:00.000Z',
    config,
    slices: [{ index: 0, key: 's000', since: config.range.since.unix, until: config.range.until.unix }],
    user: makeArchiveUser(UID),
  }
}

function makeRecord(
  mblogId: string,
  options: {
    createdAt?: string
    issues?: UserArchiveRecord['issues']
    comments?: UserArchiveRecord['record']['comments']
    raw?: unknown
  } = {},
): UserArchiveRecord {
  return {
    slice: 's000',
    mblogId,
    record: {
      mblogId,
      source: 'timeline',
      tweet: {
        id: mblogId,
        mblogId,
        createdAt: options.createdAt ?? '2025-01-15T00:00:00.000Z',
        text: '',
        source: '微博网页版',
        user: {} as never,
        stats: { likes: 0, comments: 0, reposts: 0 },
        visible: {} as never,
        media: [],
      },
      comments: options.comments ?? [],
      ...(options.raw === undefined ? {} : { raw: options.raw }),
    },
    issues: options.issues ?? [],
  }
}

describe('dedupeUserArchiveRecords', () => {
  it('keepsEntryWithFewerIssues', () => {
    const noisy = makeRecord('A', { issues: [{ stage: 'detail', code: 'X', message: 'x' }] })
    const clean = makeRecord('A')
    expect(dedupeUserArchiveRecords([noisy, clean])).toEqual([clean])
  })

  it('sameIssues_keepsLaterEntry', () => {
    const first = makeRecord('A')
    const second = { ...makeRecord('A'), slice: 'later' }
    expect(dedupeUserArchiveRecords([first, second])).toEqual([second])
  })
})

describe('assembleUserArchive', () => {
  it('dedupesSortsAndComputesStats', () => {
    const comments = [
      makeArchiveComment('c1', { replies: [makeArchiveComment('r1'), makeArchiveComment('r2')] }),
    ]
    const { file, summary, complete } = assembleUserArchive({
      meta: makeMeta(),
      records: [
        makeRecord('old', { createdAt: '2024-01-01T00:00:00.000Z' }),
        makeRecord('new', { createdAt: '2025-06-01T00:00:00.000Z', comments }),
        makeRecord('new', { createdAt: '2025-06-01T00:00:00.000Z', comments }),
      ],
      issues: [],
    })

    expect(file.tweets.map(tweet => tweet.mblogId)).toEqual(['new', 'old'])
    expect(summary).toMatchObject({ tweets: 2, comments: 1, replies: 2, errors: 0, complete: true })
    expect(complete).toBe(true)
    expect(file.query).toMatchObject({ uid: UID, includeComments: true, includeReposts: false })
  })

  it('collectsAndDedupesIssues', () => {
    const shared = { stage: 'comments' as const, code: 'UNKNOWN', message: 'boom', mblogId: 'A' }
    const extra = { stage: 'timeline' as const, code: 'UNKNOWN', message: 'enum' }
    const { file, summary, complete } = assembleUserArchive({
      meta: makeMeta(),
      records: [makeRecord('A', { issues: [shared] })],
      issues: [shared, extra],
    })

    expect(file.errors).toEqual([shared, extra])
    expect(summary.errors).toBe(2)
    expect(complete).toBe(false)
  })

  it('fatalErrorMarksIncomplete', () => {
    const { file, complete } = assembleUserArchive({
      meta: makeMeta(),
      records: [],
      issues: [],
      fatalError: new Error('auth gone'),
    })
    expect(file.errors[0]).toMatchObject({ stage: 'timeline', code: 'UNKNOWN', message: 'auth gone' })
    expect(complete).toBe(false)
  })

  it('abortedMarksIncomplete', () => {
    const { file, complete } = assembleUserArchive({
      meta: makeMeta(),
      records: [],
      issues: [],
      aborted: true,
    })
    expect(file.errors[0]).toMatchObject({ code: 'ABORTED' })
    expect(complete).toBe(false)
  })

  it('stripsLegacyRaw', () => {
    const { file } = assembleUserArchive({
      meta: makeMeta(),
      records: [makeRecord('A', { raw: { big: true } })],
      issues: [],
    })
    expect('raw' in file.tweets[0]).toBe(false)
  })
})
