import { describe, expect, it } from 'vitest'
import {
  isStableReserved,
  shapeOf,
  validateMethodTiers,
} from '../../../scripts/check-api-surface'

describe('shapeOf', () => {
  it('groups options and progress by name', () => {
    expect(shapeOf('TweetCommentsOptions')).toBe('options')
    expect(shapeOf('LogWriteStream')).toBe('extension')
    expect(shapeOf('ArchiveProgress')).toBe('progress')
    expect(shapeOf('ArchiveProgressEvent')).toBe('progress')
    expect(shapeOf('formatArchiveProgress')).toBe('progress')
  })

  it('groups runtime labels and extension shapes', () => {
    expect(shapeOf('ArchivePhase')).toBe('runtime')
    expect(shapeOf('CapabilityStatus')).toBe('runtime')
    expect(shapeOf('WEIBO_CAPABILITIES')).toBe('runtime')
    expect(shapeOf('UserArchiveEvent')).toBe('runtime')
    expect(shapeOf('Credential')).toBe('extension')
    expect(shapeOf('TransportFailure')).toBe('extension')
  })

  it('falls back to model for contract types', () => {
    expect(shapeOf('ArchiveFile')).toBe('model')
    expect(shapeOf('ITweet')).toBe('model')
  })
})

describe('isStableReserved', () => {
  it('rejects shape helpers that evolve with minor versions', () => {
    expect(isStableReserved('TweetCommentsOptions')).toBe(true)
    expect(isStableReserved('ArchiveProgressSummary')).toBe(true)
    expect(isStableReserved('LogWriteStream')).toBe(true)
    expect(isStableReserved('ITweet')).toBe(false)
  })
})

describe('validateMethodTiers', () => {
  const methods = [
    { className: 'TweetService', name: 'fetchRawComments' },
    { className: 'TweetService', name: 'comments' },
  ]

  it('requires every fetchRaw* method to be declared evolving', () => {
    expect(validateMethodTiers(methods, [])).toEqual([
      '公开方法 TweetService.fetchRawComments() 返回上游原始形状，必须登记到 methodTiers.evolving',
    ])
    expect(validateMethodTiers(methods, ['TweetService.fetchRawComments'])).toEqual([])
  })

  it('rejects declarations that no longer match a public method', () => {
    expect(validateMethodTiers(methods, ['TweetService.fetchRawComments', 'TweetService.fetchRawMissing'])).toEqual([
      'methodTiers.evolving 中的 "TweetService.fetchRawMissing" 不是公开方法（请移除）',
    ])
  })
})
