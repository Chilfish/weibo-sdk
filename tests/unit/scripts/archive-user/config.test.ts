import type { RunConfig } from '../../../../scripts/archive-user/types'
import { describe, expect, it } from 'vitest'
import {
  assertResumeConfig,
  buildConfig,
  normalizeUid,
  positiveInt,
  resolveBurst,
  resolveConcurrency,
  resolveDelay,
  resolveSliceDays,
} from '../../../../scripts/archive-user/config'
import { MAX_BURST, MAX_CONCURRENCY } from '../../../../scripts/archive-user/constants'

const UID = '1234567890'

function baseConfig(): RunConfig {
  return buildConfig(UID, {
    'since': '2025-01-01',
    'until': '2025-01-31',
    'comment-order': 'time',
  })
}

describe('normalizeUid', () => {
  it('numericInput_returnsAsIs', () => {
    expect(normalizeUid(' 1234567890 ')).toBe(UID)
  })

  it('profileUrl_extractsUid', () => {
    expect(normalizeUid('https://weibo.com/u/1234567890')).toBe(UID)
    expect(normalizeUid('https://weibo.com/1234567890')).toBe(UID)
    expect(normalizeUid('https://weibo.cn/1234567890')).toBe(UID)
  })

  it('nonNumeric_throws', () => {
    expect(() => normalizeUid('someone')).toThrow(/UID 必须是数字/)
  })
})

describe('option resolvers', () => {
  it('positiveInt_zeroAndInvalid_returnUndefinedOrThrow', () => {
    expect(positiveInt('0', 'max-comments')).toBeUndefined()
    expect(positiveInt('12', 'max-comments')).toBe(12)
    expect(() => positiveInt('-1', 'max-comments')).toThrow()
    expect(() => positiveInt('abc', 'max-comments')).toThrow()
  })

  it('resolveConcurrency_clampsAndRejectsNonPositive', () => {
    expect(resolveConcurrency(undefined)).toBe(6)
    expect(resolveConcurrency('99')).toBe(MAX_CONCURRENCY)
    expect(() => resolveConcurrency('0')).toThrow()
  })

  it('resolveSliceDays_allowsZeroAndRejectsOutOfRange', () => {
    expect(resolveSliceDays('0')).toBe(0)
    expect(resolveSliceDays(undefined)).toBe(30)
    expect(() => resolveSliceDays('3661')).toThrow()
  })

  it('resolveDelayAndBurst_rejectNonPositiveAndClampBurst', () => {
    expect(resolveDelay(undefined)).toBe(1000)
    expect(() => resolveDelay('0')).toThrow()
    expect(resolveBurst('999')).toBe(MAX_BURST)
    expect(() => resolveBurst('0')).toThrow()
  })
})

describe('buildConfig', () => {
  it('defaults_includeCommentsAndRepliesButNotReposts', () => {
    const config = baseConfig()
    expect(config.options).toMatchObject({
      includeComments: true,
      includeReplies: true,
      includeReposts: false,
      commentOrder: 'time',
    })
    expect(config.uid).toBe(UID)
  })

  it('negatedFlags_disableStages', () => {
    const config = buildConfig(UID, {
      'since': '2025-01-01',
      'until': '2025-01-31',
      'no-comments': true,
      'no-replies': true,
      'reposts': true,
    })
    expect(config.options.includeComments).toBe(false)
    expect(config.options.includeReplies).toBe(false)
    expect(config.options.includeReposts).toBe(true)
  })

  it('sinceAfterUntil_throws', () => {
    expect(() => buildConfig(UID, { since: '2025-02-01', until: '2025-01-01' })).toThrow(/不能晚于/)
  })

  it('invalidCommentOrder_throws', () => {
    expect(() => buildConfig(UID, {
      'since': '2025-01-01',
      'until': '2025-01-31',
      'comment-order': 'newest',
    })).toThrow(/comment-order/)
  })
})

describe('assertResumeConfig', () => {
  it('sameUidAndNoExplicitChanges_passes', () => {
    const config = baseConfig()
    expect(() => assertResumeConfig(config, UID, new Set(), {})).not.toThrow()
  })

  it('differentUid_throws', () => {
    const config = baseConfig()
    expect(() => assertResumeConfig(config, '999', new Set(), {})).toThrow(/journal 属于 uid/)
  })

  it('explicitSinceMismatch_throws', () => {
    const config = baseConfig()
    expect(() => assertResumeConfig(config, UID, new Set(['since']), { since: '2025-01-02' })).toThrow(/与断点日志不一致/)
  })

  it('addingRepostsMidRun_throws', () => {
    const config = baseConfig()
    expect(() => assertResumeConfig(config, UID, new Set(['reposts']), { reposts: true })).toThrow(/--reposts/)
  })

  it('disablingCommentsMidRun_throws', () => {
    const config = baseConfig()
    expect(() => assertResumeConfig(config, UID, new Set(['no-comments']), { 'no-comments': true })).toThrow(/--no-comments/)
  })
})
