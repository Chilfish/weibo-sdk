import { describe, expect, it } from 'vitest'
import { parseSessionUid } from '~/utils/sessionUid'

describe('parseSessionUid', () => {
  it('reads uid from a real verified_url', () => {
    expect(parseSessionUid({
      verified_url: 'https://verified.weibo.com/verify?fr=myverified?uid=7679065628',
    })).toBe('7679065628')
  })

  it('supports the standard query separator', () => {
    expect(parseSessionUid({ verified_url: 'https://example.com/path?uid=12345' })).toBe('12345')
  })

  it('returns undefined when uid is absent', () => {
    expect(parseSessionUid({})).toBeUndefined()
    expect(parseSessionUid({ verified_url: 'https://verified.weibo.com/verify?fr=myverified' })).toBeUndefined()
  })
})
