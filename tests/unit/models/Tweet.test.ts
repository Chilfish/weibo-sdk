import { describe, expect, it } from 'vitest'
import { Tweet } from '~/models/data/Tweet'
import { TweetVisible } from '~/types/domain/ITweet'

describe('tweet model normalization (mymblog)', () => {
  it('maps core fields and counters', () => {
    const raw: any = {
      id: 1,
      idstr: '1',
      mblogid: 'QqsYymYOS',
      created_at: 'now',
      text: '<span>html</span>',
      text_raw: 'plain',
      region_name: '上海',
      source: '微博网页版',
      visible: { type: 0, list_id: 0 },
      attitudes_count: 10,
      comments_count: 2,
      reposts_count: 3,
      user: {
        id: 2,
        idstr: '2',
        screen_name: 'u',
        avatar_hd: 'hd',
        avatar_large: '',
        profile_image_url: '',
        verified: true,
        verified_type: 1,
      },
    }

    const tweet = new Tweet(raw)
    expect(tweet.id).toBe('1')
    expect(tweet.mblogId).toBe('QqsYymYOS')
    expect(tweet.createdAt).toBe('now')
    expect(tweet.text).toBe('plain')
    expect(tweet.textHtml).toBe('<span>html</span>')
    expect(tweet.regionName).toBe('上海')
    expect(tweet.source).toBe('微博网页版')
    expect(tweet.visible).toBe(TweetVisible.PUBLIC)
    expect(tweet.stats).toEqual({ likes: 10, comments: 2, reposts: 3 })
    expect(tweet.user.id).toBe('2')
    expect(tweet.user.name).toBe('u')
    expect(tweet.user.avatar).toBe('hd')
    expect(tweet.media).toEqual([])
  })

  it('falls back to public visibility for unknown values', () => {
    const raw: any = {
      id: 1,
      idstr: '1',
      mblogid: 'x',
      created_at: 'now',
      text: '',
      text_raw: '',
      region_name: '',
      source: '',
      visible: { type: 999, list_id: 0 },
      attitudes_count: 0,
      comments_count: 0,
      reposts_count: 0,
      user: {
        id: 2,
        idstr: '2',
        screen_name: '',
        avatar_hd: '',
        avatar_large: '',
        profile_image_url: '',
        verified: false,
        verified_type: 0,
      },
    }

    const tweet = new Tweet(raw)
    expect(tweet.visible).toBe(TweetVisible.PUBLIC)
  })
})
