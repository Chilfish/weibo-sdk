import { describe, expect, it } from 'vitest'
import { normalizeArchiveUid, resolveCliTuning, userArchiveOptionsFromArgs } from '~/cli/commands/archiveUser'
import { InvalidConfigError } from '~/models/errors/ConfigError'

describe('resolveCliTuning', () => {
  it('defaultsToStandardPreset', () => {
    expect(resolveCliTuning({})).toEqual({
      fast: false,
      concurrency: 20,
      delayMs: 300,
      burst: 8,
    })
  })

  it('fastPresetUsesAggressiveValues', () => {
    expect(resolveCliTuning({ fast: true })).toEqual({
      fast: true,
      concurrency: 32,
      delayMs: 100,
      burst: 16,
    })
  })

  it('explicitValuesOverrideFastPreset', () => {
    expect(resolveCliTuning({ fast: true, concurrency: '8', delay: '500', burst: '4' })).toEqual({
      fast: true,
      concurrency: 8,
      delayMs: 500,
      burst: 4,
    })
  })
})

describe('normalizeArchiveUid', () => {
  it('acceptsDigitsAndProfileUrls', () => {
    expect(normalizeArchiveUid(' 1234567890 ')).toBe('1234567890')
    expect(normalizeArchiveUid('https://weibo.com/u/1234567890')).toBe('1234567890')
    expect(normalizeArchiveUid('https://weibo.cn/1234567890')).toBe('1234567890')
  })

  it('rejectsNonNumericInput', () => {
    expect(() => normalizeArchiveUid('someone')).toThrow(InvalidConfigError)
  })
})

describe('userArchiveOptionsFromArgs', () => {
  it('mapsNegatedFlagsAndLimits', () => {
    const options = userArchiveOptionsFromArgs({
      'since': '2025-01-01',
      'until': '2025-01-31',
      'slice-days': '0',
      'comments': false,
      'replies': false,
      'reposts': true,
      'comment-order': 'hot',
      'max-comments': '5',
      'max-comment-pages': '2',
      'max-replies': '3',
      'max-reply-pages': '1',
      'max-reposts': '4',
      'max-repost-pages': '2',
      'concurrency': '3',
    })

    expect(options).toMatchObject({
      since: '2025-01-01',
      until: '2025-01-31',
      sliceDays: 0,
      includeComments: false,
      includeReplies: false,
      includeReposts: true,
      commentOrder: 'hot',
      maxComments: 5,
      maxCommentPages: 2,
      maxReplies: 3,
      maxReplyPages: 1,
      maxReposts: 4,
      maxRepostPages: 2,
      concurrency: 3,
    })
  })

  it('defaultsKeepCommentsAndRepliesOn', () => {
    const options = userArchiveOptionsFromArgs({})
    expect(options.includeComments).toBe(true)
    expect(options.includeReplies).toBe(true)
    expect(options.includeReposts).toBe(false)
    expect(options.maxCommentPages).toBeUndefined()
    expect(options.maxReplyPages).toBeUndefined()
  })

  it('allFlagsMapToZeroPageLimits', () => {
    const options = userArchiveOptionsFromArgs({ 'all-comments': true, 'all-replies': true })
    expect(options.maxCommentPages).toBe(0)
    expect(options.maxReplyPages).toBe(0)
  })

  it('zeroPageLimitIsPreserved', () => {
    const options = userArchiveOptionsFromArgs({
      'max-comment-pages': '0',
      'max-reply-pages': '0',
    })
    expect(options.maxCommentPages).toBe(0)
    expect(options.maxReplyPages).toBe(0)
  })

  it('omitsImplicitDefaultsWhenRawArgsArePresent', () => {
    const options = userArchiveOptionsFromArgs({
      '__rawArgs': ['archive', 'user', '123', '--until', '2025-01-31'],
      'comments': true,
      'replies': true,
      'reposts': true,
      'comment-order': 'time',
    })

    expect(options.includeComments).toBeUndefined()
    expect(options.includeReplies).toBeUndefined()
    expect(options.includeReposts).toBeUndefined()
    expect(options.commentOrder).toBeUndefined()
  })

  it('keepsExplicitFlagsWhenRawArgsArePresent', () => {
    const options = userArchiveOptionsFromArgs({
      '__rawArgs': ['archive', 'user', '123', '--no-comments', '--reposts', '--comment-order', 'hot'],
      'comment-order': 'hot',
    })

    expect(options.includeComments).toBe(false)
    expect(options.includeReposts).toBe(true)
    expect(options.commentOrder).toBe('hot')
  })

  it('invalidCommentOrder_throws', () => {
    expect(() => userArchiveOptionsFromArgs({ 'comment-order': 'newest' })).toThrow(InvalidConfigError)
  })

  it('invalidSliceDays_throws', () => {
    expect(() => userArchiveOptionsFromArgs({ 'slice-days': '-1' })).toThrow(InvalidConfigError)
  })
})
