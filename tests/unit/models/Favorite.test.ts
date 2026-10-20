import { describe, expect, it } from 'vitest'
import { matchesFavoriteTag } from '~/models/data/Favorite'

describe('matchesFavoriteTag', () => {
  it('matches common tag id and name fields', () => {
    const item = {
      tags: [
        { id: 1001, name: '技术' },
        { idstr: '1002', tag_name: '生活' },
        { tag_id: '1003', title: '摄影' },
        { tagid: 1004, tag: '旅行' },
      ],
    }

    expect(matchesFavoriteTag(item, 1001)).toBe(true)
    expect(matchesFavoriteTag(item, '技术')).toBe(true)
    expect(matchesFavoriteTag(item, '1002')).toBe(true)
    expect(matchesFavoriteTag(item, '生活')).toBe(true)
    expect(matchesFavoriteTag(item, 1003)).toBe(true)
    expect(matchesFavoriteTag(item, '摄影')).toBe(true)
    expect(matchesFavoriteTag(item, 1004)).toBe(true)
    expect(matchesFavoriteTag(item, '旅行')).toBe(true)
  })

  it('matches primitive tag entries', () => {
    expect(matchesFavoriteTag({ tags: ['技术', 1001] }, '技术')).toBe(true)
    expect(matchesFavoriteTag({ tags: ['技术', 1001] }, 1001)).toBe(true)
  })

  it('returns false for missing / malformed tags', () => {
    expect(matchesFavoriteTag({}, '技术')).toBe(false)
    expect(matchesFavoriteTag({ tags: [] }, '技术')).toBe(false)
    expect(matchesFavoriteTag({ tags: '技术' }, '技术')).toBe(false)
    expect(matchesFavoriteTag({ tags: [null, 42, { name: '生活' }] }, '技术')).toBe(false)
    expect(matchesFavoriteTag(null, '技术')).toBe(false)
    expect(matchesFavoriteTag('not-an-object', '技术')).toBe(false)
  })
})
