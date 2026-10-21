import { describe, expect, it } from 'vitest'
import { isRawTweet, Tweet } from '~/models/data/Tweet'
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

  it('falls back to raw_text for mobile cards without text_raw', () => {
    const raw: any = {
      id: 1,
      idstr: '1',
      mblogid: 'x',
      created_at: 'now',
      text: '//<a href=\'/n/u\'>@u</a>:转发微博',
      raw_text: '//@u:转发微博',
      source: '',
      visible: { type: 0, list_id: 0 },
      user: { id: 2, idstr: '2', screen_name: 'u' },
    }

    const tweet = new Tweet(raw)
    expect(tweet.text).toBe('//@u:转发微博')
  })

  it('decodes text HTML when neither text_raw nor raw_text is present', () => {
    const raw: any = {
      id: 1,
      idstr: '1',
      mblogid: 'x',
      created_at: 'now',
      text: 'a &amp; b<br />c <a href="/n/u">@u</a>',
      source: '',
      visible: { type: 0, list_id: 0 },
      user: { id: 2, idstr: '2', screen_name: 'u' },
      retweeted_status: {
        id: 3,
        idstr: '3',
        mblogid: 'y',
        created_at: 'now',
        text: '原文 &amp; 配图<br />第二行',
        source: '',
        visible: { type: 0, list_id: 0 },
        user: { id: 4, idstr: '4', screen_name: 'v' },
      },
    }

    const tweet = new Tweet(raw)
    expect(tweet.text).toBe('a & b\nc @u')
    expect(tweet.retweetedStatus?.text).toBe('原文 & 配图\n第二行')
  })

  it('extracts pageInfo', () => {
    const raw: any = {
      id: 1,
      idstr: '1',
      mblogid: 'x',
      created_at: 'now',
      text: '',
      text_raw: '',
      region_name: '',
      source: '',
      visible: { type: 0, list_id: 0 },
      attitudes_count: 0,
      comments_count: 0,
      reposts_count: 0,
      user: {
        id: 2,
        idstr: '2',
        screen_name: 'u',
        avatar_hd: '',
        avatar_large: '',
        profile_image_url: '',
        verified: false,
        verified_type: 0,
      },
      page_info: {
        page_id: 'pid',
        page_title: 'title',
        page_url: 'https://example.com',
        page_pic: 'https://img',
        type: 42,
        object_type: 'video',
      },
    }

    const tweet = new Tweet(raw)
    expect(tweet.pageInfo).toEqual({
      pageId: 'pid',
      pageTitle: 'title',
      pageUrl: 'https://example.com',
      pagePic: 'https://img',
      type: 42,
      objectType: 'video',
    })
  })

  it('extracts geo coordinates and address', () => {
    const raw: any = {
      id: 1,
      idstr: '1',
      mblogid: 'x',
      created_at: 'now',
      text: '',
      text_raw: '',
      region_name: '',
      source: '',
      visible: { type: 0, list_id: 0 },
      attitudes_count: 0,
      comments_count: 0,
      reposts_count: 0,
      user: {
        id: 2,
        idstr: '2',
        screen_name: 'u',
        avatar_hd: '',
        avatar_large: '',
        profile_image_url: '',
        verified: false,
        verified_type: 0,
      },
      geo: {
        type: 'Point',
        coordinates: [121.5, 31.2],
      },
      tag_struct: [
        { otype: 'place', tag_name: '上海市' },
      ],
    }

    const tweet = new Tweet(raw)
    expect(tweet.geo).toEqual({ longitude: 121.5, latitude: 31.2, address: '上海市' })
  })

  it('extracts media from pic_infos (including livephoto)', () => {
    const raw: any = {
      id: 1,
      idstr: '1',
      mblogid: 'x',
      created_at: 'now',
      text: '',
      text_raw: '',
      region_name: '',
      source: '',
      visible: { type: 0, list_id: 0 },
      attitudes_count: 0,
      comments_count: 0,
      reposts_count: 0,
      user: {
        id: 2,
        idstr: '2',
        screen_name: 'u',
        avatar_hd: '',
        avatar_large: '',
        profile_image_url: '',
        verified: false,
        verified_type: 0,
      },
      pic_ids: ['a'],
      pic_infos: {
        a: {
          pic_id: 'a',
          type: 'pic',
          largest: { url: 'https://img/a.jpg', width: 100, height: 80 },
          video: 'https://video/a.mov',
        },
      },
    }

    const tweet = new Tweet(raw)
    expect(tweet.media).toEqual([
      {
        id: 'a',
        type: 'livephoto',
        imageUrl: 'https://img/a.jpg',
        videoUrl: 'https://video/a.mov',
        width: 100,
        height: 80,
      },
    ])
  })

  it('extracts retweetedStatus recursively', () => {
    const raw: any = {
      id: 1,
      idstr: '1',
      mblogid: 'x',
      created_at: 'now',
      text: '',
      text_raw: '',
      region_name: '',
      source: '',
      visible: { type: 0, list_id: 0 },
      attitudes_count: 0,
      comments_count: 0,
      reposts_count: 0,
      user: {
        id: 2,
        idstr: '2',
        screen_name: 'u',
        avatar_hd: '',
        avatar_large: '',
        profile_image_url: '',
        verified: false,
        verified_type: 0,
      },
      retweeted_status: {
        id: 9,
        idstr: '9',
        mblogid: 'r',
        created_at: 'then',
        text: '',
        text_raw: 'rt',
        region_name: '',
        source: '',
        visible: { type: 0, list_id: 0 },
        attitudes_count: 0,
        comments_count: 0,
        reposts_count: 0,
        user: {
          id: 3,
          idstr: '3',
          screen_name: 'ru',
          avatar_hd: '',
          avatar_large: '',
          profile_image_url: '',
          verified: false,
          verified_type: 0,
        },
        pic_ids: ['p1'],
        pic_infos: {
          p1: {
            pic_id: 'p1',
            type: 'pic',
            largest: { url: 'https://img/p1.jpg', width: 1, height: 2 },
          },
        },
      },
    }

    const tweet = new Tweet(raw)
    expect(tweet.retweetedStatus?.id).toBe('9')
    expect(tweet.retweetedStatus?.media).toHaveLength(1)
  })

  it('extracts media from mix_media_info (video)', () => {
    const raw: any = {
      id: 1,
      idstr: '1',
      mblogid: 'x',
      created_at: 'now',
      text: '',
      text_raw: '',
      region_name: '',
      source: '',
      visible: { type: 0, list_id: 0 },
      attitudes_count: 0,
      comments_count: 0,
      reposts_count: 0,
      user: {
        id: 2,
        idstr: '2',
        screen_name: 'u',
        avatar_hd: '',
        avatar_large: '',
        profile_image_url: '',
        verified: false,
        verified_type: 0,
      },
      mix_media_info: {
        items: [
          {
            type: 'video',
            id: 'v1',
            data: {
              largecover: { url: 'https://cover', width: 1280, height: 720 },
              media_info: {
                mp4_hd_url: 'https://mp4',
                duration: 12,
              },
            },
          },
        ],
      },
    }

    const tweet = new Tweet(raw)
    expect(tweet.media).toEqual([
      {
        id: 'v1',
        type: 'video',
        imageUrl: 'https://cover',
        videoUrl: 'https://mp4',
        duration: 12,
        width: 1280,
        height: 720,
      },
    ])
  })
})

describe('isRawTweet guard (E2 contract hygiene)', () => {
  it('accepts objects with a string mblogid', () => {
    expect(isRawTweet({ mblogid: 'QqsYymYOS', text: 'hi' })).toBe(true)
    expect(isRawTweet({ mblogid: 'x', retweeted_status: { mblogid: 'y' } })).toBe(true)
  })

  it('rejects null, arrays, primitives and objects without string mblogid', () => {
    expect(isRawTweet(null)).toBe(false)
    expect(isRawTweet(undefined)).toBe(false)
    expect(isRawTweet([{ mblogid: 'x' }])).toBe(false)
    expect(isRawTweet('mblogid')).toBe(false)
    expect(isRawTweet(42)).toBe(false)
    expect(isRawTweet({})).toBe(false)
    expect(isRawTweet({ mblogid: 123 })).toBe(false)
    expect(isRawTweet({ mblogid: undefined })).toBe(false)
  })
})
