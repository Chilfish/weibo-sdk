import { describe, expect, it } from 'vitest'
import { normalizeArchiveUid, userArchiveOptionsFromArgs } from '~/cli/commands/archiveUser'
import { InvalidConfigError } from '~/models/errors/ConfigError'

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
  })

  it('invalidCommentOrder_throws', () => {
    expect(() => userArchiveOptionsFromArgs({ 'comment-order': 'newest' })).toThrow(InvalidConfigError)
  })

  it('invalidSliceDays_throws', () => {
    expect(() => userArchiveOptionsFromArgs({ 'slice-days': '-1' })).toThrow(InvalidConfigError)
  })
})
