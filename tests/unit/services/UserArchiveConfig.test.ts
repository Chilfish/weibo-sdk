import type { UserArchiveMeta, UserArchiveRunConfig } from '~/types/archive/IUserArchive'
import { makeArchiveUser } from 'tests/testkit/userArchive'
import { describe, expect, it } from 'vitest'
import { InvalidConfigError, ResumeMismatchError } from '~/models/errors/ConfigError'
import {
  applyUserArchiveResumeDefaults,
  buildUserArchiveConfig,
  DEFAULT_USER_ARCHIVE_CONCURRENCY,
  MAX_USER_ARCHIVE_CONCURRENCY,
  mergeUserArchiveMeta,
  resolveUserArchiveConcurrency,
  resolveUserArchiveResume,
  validateUserArchiveResume,
} from '~/services/public/userArchive/config'
import { planUserArchiveSlices } from '~/services/public/userArchive/slices'

const UID = '1234567890'
const BASE = { since: '2025-01-01', until: '2025-01-31', sliceDays: 0 } as const

function metaFrom(config: UserArchiveRunConfig): UserArchiveMeta {
  return {
    type: 'meta',
    schema: 'weibo-user-archive-journal/v2',
    createdAt: '2025-02-01T00:00:00.000Z',
    config,
    slices: planUserArchiveSlices(config.range.since.unix, config.range.until.unix, config.sliceDays),
    user: makeArchiveUser(UID),
  }
}

describe('buildUserArchiveConfig', () => {
  it('defaultsIncludeCommentsAndRepliesButNotReposts', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE })
    expect(config.options).toMatchObject({
      includeComments: true,
      includeReplies: true,
      includeReposts: false,
      commentOrder: 'time',
      maxCommentPages: 2,
      maxReplyPages: 2,
    })
    expect(config.sliceDays).toBe(0)
  })

  it('resolvesDateRangeAndKeepsOriginalInputs', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE })
    expect(config.range.since).toMatchObject({ input: '2025-01-01' })
    expect(config.range.until).toMatchObject({ input: '2025-01-31' })
    expect(config.range.since.unix).toBeLessThan(config.range.until.unix)
  })

  it('sinceAfterUntil_throwsConfigInvalid', () => {
    expect(() => buildUserArchiveConfig(UID, { since: '2025-02-01', until: '2025-01-01' }))
      .toThrow(InvalidConfigError)
  })

  it('invalidCommentOrder_throwsConfigInvalid', () => {
    expect(() => buildUserArchiveConfig(UID, { ...BASE, commentOrder: 'newest' as never }))
      .toThrow(InvalidConfigError)
  })

  it('zeroMaxValuesMeanUnlimited', () => {
    const config = buildUserArchiveConfig(UID, {
      ...BASE,
      maxComments: 0,
      maxCommentPages: 0,
      maxReplies: 0,
      maxReplyPages: 0,
    })
    expect(config.options.maxComments).toBeUndefined()
    expect(config.options.maxCommentPages).toBeUndefined()
    expect(config.options.maxReplies).toBeUndefined()
    expect(config.options.maxReplyPages).toBeUndefined()
  })

  it('explicitPageLimitsOverrideDefaults', () => {
    const config = buildUserArchiveConfig(UID, {
      ...BASE,
      maxCommentPages: 5,
      maxReplyPages: 3,
    })
    expect(config.options.maxCommentPages).toBe(5)
    expect(config.options.maxReplyPages).toBe(3)
  })

  it('oldJournalWithoutPageLimits_staysUnlimitedOnResume', () => {
    const config = buildUserArchiveConfig(UID, {
      ...BASE,
      maxCommentPages: 0,
      maxReplyPages: 0,
    })
    delete config.options.maxCommentPages
    delete config.options.maxReplyPages

    const resumed = buildUserArchiveConfig(UID, applyUserArchiveResumeDefaults({}, config))
    expect(resumed.options.maxCommentPages).toBeUndefined()
    expect(resumed.options.maxReplyPages).toBeUndefined()
  })

  it('sliceDaysOutOfRange_throwsConfigInvalid', () => {
    expect(() => buildUserArchiveConfig(UID, { ...BASE, sliceDays: 3661 })).toThrow(InvalidConfigError)
    expect(() => buildUserArchiveConfig(UID, { ...BASE, sliceDays: 1.5 })).toThrow(InvalidConfigError)
  })
})

describe('resolveUserArchiveResume', () => {
  it('defaultsToStrict', () => {
    expect(resolveUserArchiveResume(undefined)).toBe('strict')
    expect(resolveUserArchiveResume('')).toBe('strict')
    expect(resolveUserArchiveResume('strict')).toBe('strict')
    expect(resolveUserArchiveResume('merge')).toBe('merge')
  })

  it('rejectsUnknownValues', () => {
    expect(() => resolveUserArchiveResume('loose')).toThrow(InvalidConfigError)
  })
})

describe('applyUserArchiveResumeDefaults', () => {
  it('strictInheritsRangeAndContentOptions', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE, includeReposts: true })
    const options = applyUserArchiveResumeDefaults({}, config, 'strict')
    expect(options).toMatchObject({ since: '2025-01-01', until: '2025-01-31', includeReposts: true })
  })

  it('mergeInheritsContentOptionsButNotRange', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE, includeReposts: true })
    const options = applyUserArchiveResumeDefaults({ since: '2025-02-01' }, config, 'merge')
    expect(options.since).toBe('2025-02-01')
    expect(options.until).toBeUndefined()
    expect(options.includeReposts).toBe(true)
  })
})

describe('concurrency', () => {
  it('defaultsAndClamps', () => {
    expect(resolveUserArchiveConcurrency(undefined)).toBe(DEFAULT_USER_ARCHIVE_CONCURRENCY)
    expect(resolveUserArchiveConcurrency(99)).toBe(MAX_USER_ARCHIVE_CONCURRENCY)
    expect(resolveUserArchiveConcurrency(4)).toBe(4)
  })

  it('rejectsNonPositive', () => {
    expect(() => resolveUserArchiveConcurrency(0)).toThrow(InvalidConfigError)
  })
})

describe('validateUserArchiveResume', () => {
  it('sameConfig_passes', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE })
    expect(() => validateUserArchiveResume(metaFrom(config), config)).not.toThrow()
  })

  it('differentUid_throws', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE })
    const other = buildUserArchiveConfig('999', { ...BASE })
    expect(() => validateUserArchiveResume(metaFrom(config), other)).toThrow(/uid/)
  })

  it('differentRange_throwsResumeMismatch', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE })
    const other = buildUserArchiveConfig(UID, { since: '2025-01-01', until: '2025-02-28', sliceDays: 0 })
    expect(() => validateUserArchiveResume(metaFrom(config), other)).toThrow(ResumeMismatchError)
    expect(() => validateUserArchiveResume(metaFrom(config), other)).toThrow(/until/)
    try {
      validateUserArchiveResume(metaFrom(config), other)
    }
    catch (error) {
      expect(error).toMatchObject({ code: 'RESUME_MISMATCH', context: { field: 'resume', mismatch: 'until' } })
    }
  })

  it('differentContentOptions_throws', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE })
    const other = buildUserArchiveConfig(UID, { ...BASE, includeReposts: true })
    expect(() => validateUserArchiveResume(metaFrom(config), other)).toThrow(/options/)
  })

  it('differentSlicePlan_throws', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE })
    const meta = metaFrom(config)
    meta.slices = [{ index: 0, key: 'other', since: 1, until: 2 }]
    expect(() => validateUserArchiveResume(meta, config)).toThrow(/slice plan/)
  })

  it('mergeOnlyChecksUid', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE })
    const other = buildUserArchiveConfig(UID, { since: '2025-02-01', until: '2025-02-28', sliceDays: 0, includeReposts: true })
    expect(() => validateUserArchiveResume(metaFrom(config), other, 'merge')).not.toThrow()

    const foreign = buildUserArchiveConfig('999', { ...BASE })
    expect(() => validateUserArchiveResume(metaFrom(config), foreign, 'merge')).toThrow(/uid/)
  })
})

describe('mergeUserArchiveMeta', () => {
  it('replansSlicesAndDropsStaleTotals', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE })
    const meta = metaFrom(config)
    const oldKey = meta.slices[0].key
    meta.totals = { [oldKey]: 10, stale: 5 }

    const next = buildUserArchiveConfig(UID, { since: '2025-03-01', until: '2025-03-31', sliceDays: 0 })
    const merged = mergeUserArchiveMeta(meta, next)

    expect(merged.createdAt).toBe(meta.createdAt)
    expect(merged.user).toEqual(meta.user)
    expect(merged.config).toEqual(next)
    expect(merged.slices).toEqual(planUserArchiveSlices(next.range.since.unix, next.range.until.unix, 0))
    expect(merged.totals).toBeUndefined()
  })

  it('keepsTotalsForSlicesStillInThePlan', () => {
    const config = buildUserArchiveConfig(UID, { ...BASE })
    const meta = metaFrom(config)
    const key = meta.slices[0].key
    meta.totals = { [key]: 10 }

    const next = buildUserArchiveConfig(UID, { since: '2025-01-01', until: '2025-02-28', sliceDays: 0 })
    // sliceDays=0 会把整个范围放进单个 key，与原 key 不同，因此 totals 仍会丢。
    expect(mergeUserArchiveMeta(meta, next).totals).toBeUndefined()

    const sameRange = buildUserArchiveConfig(UID, { ...BASE })
    expect(mergeUserArchiveMeta(meta, sameRange).totals).toEqual({ [key]: 10 })
  })
})
