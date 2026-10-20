import type { IUserMediaAsset } from '~/types/domain/IUserMediaAsset'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeImageWallItem, normalizeWaterfallVideo } from '~/models/data/Media'
import { normalizeTweet } from '~/models/data/Tweet'
import { MediaType } from '~/types/domain/ITweet'

function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join('tests/fixtures/raw', name), 'utf8'))
}

describe('normalizeImageWallItem', () => {
  it('normalizes a real pic item (url built from pid)', () => {
    const fixture = loadFixture('image_wall_p1.json')
    const raw = fixture.data.list.find((item: any) => item.type === 'pic')

    const asset = normalizeImageWallItem(raw)

    expect(asset.id).toBe(raw.pid)
    expect(asset.type).toBe(MediaType.PIC)
    expect(asset.url).toBe(`https://wx3.sinaimg.cn/large/${raw.pid}.jpg`)
    expect(asset.coverUrl).toBe(asset.url)
    expect(asset.sourceTweetId).toBeTruthy()
    expect(asset.createdAt).toMatch(/^\d{4}-\d{2}$/)
    expect(asset.objectId).toBeTruthy()
    expect(asset.videoUrl).toBeUndefined()
  })

  it('normalizes a real livephoto item (still image + mov url)', () => {
    const fixture = loadFixture('image_wall_p1.json')
    const raw = fixture.data.list.find((item: any) => item.type === 'livephoto')

    const asset = normalizeImageWallItem(raw)

    expect(asset.type).toBe(MediaType.LIVEPHOTO)
    expect(asset.url).toBe(`https://wx3.sinaimg.cn/large/${raw.pid}.jpg`)
    expect(asset.coverUrl).toBe(asset.url)
    expect(asset.videoUrl).toBe(raw.video)
  })

  it('uses .gif for gif items and keeps unknown types as UNKNOWN', () => {
    expect(normalizeImageWallItem({ pid: 'p1', type: 'gif' })).toEqual(expect.objectContaining({
      id: 'p1',
      type: MediaType.GIF,
      url: 'https://wx3.sinaimg.cn/large/p1.gif',
    }))

    expect(normalizeImageWallItem({ pid: 'p2', type: 'mystery' })).toEqual(expect.objectContaining({
      type: MediaType.UNKNOWN,
      url: 'https://wx3.sinaimg.cn/large/p2.jpg',
    }))
  })

  it('uses the video url as primary for type=video (if upstream ever returns one)', () => {
    const asset = normalizeImageWallItem({
      pid: 'p3',
      type: 'video',
      video: 'https://video.weibo.com/media/play?x=1',
    })
    expect(asset.type).toBe(MediaType.VIDEO)
    expect(asset.url).toBe('https://video.weibo.com/media/play?x=1')
    expect(asset.coverUrl).toBe('https://wx3.sinaimg.cn/large/p3.jpg')
    expect(asset.videoUrl).toBe('https://video.weibo.com/media/play?x=1')
  })

  it('tolerates missing pid and fields', () => {
    const asset = normalizeImageWallItem({})
    expect(asset.id).toBe('')
    expect(asset.url).toBe('')
    expect(asset.type).toBe(MediaType.UNKNOWN)
  })
})

describe('normalizeWaterfallVideo', () => {
  it('extracts a video asset from a real waterfall tweet', () => {
    const fixture = loadFixture('waterfall_p1.json')
    const raw = fixture.data.list[0]
    const media = raw.page_info.media_info

    const asset = normalizeWaterfallVideo(raw) as IUserMediaAsset

    expect(asset).toBeDefined()
    expect(asset.type).toBe(MediaType.VIDEO)
    expect(asset.id).toBeTruthy()
    expect(asset.url).toBe(media.mp4_hd_url || media.stream_url_hd || media.stream_url)
    expect(asset.videoUrl).toBe(asset.url)
    expect(asset.coverUrl).toBe(raw.page_info.page_pic)
    expect(asset.duration).toBe(media.duration)
    expect(asset.width).toBe(media.big_pic_info.pic_big.width)
    expect(asset.height).toBe(media.big_pic_info.pic_big.height)
    expect(asset.sourceMblogId).toBe(raw.mblogid)
    expect(asset.sourceTweetId).toBeTruthy()
    expect(asset.permanentPageUrl).toBe(media.h5_url)
    expect(asset.createdAt).toBe(raw.created_at)
  })

  it('returns undefined for non-video entries', () => {
    expect(normalizeWaterfallVideo({ mblogid: 'abc', page_info: { type: '11', object_type: 'video' } })).toBeUndefined()
    expect(normalizeWaterfallVideo({ mblogid: 'abc', pic_infos: {} })).toBeUndefined()
    expect(normalizeWaterfallVideo(null)).toBeUndefined()
  })
})

describe('normalizeTweet page_info media', () => {
  it('maps page_info.media_info into TweetMedia (video waterfall)', () => {
    const fixture = loadFixture('waterfall_p1.json')
    const raw = fixture.data.list[0]

    const tweet = normalizeTweet(raw)

    expect(tweet.media).toHaveLength(1)
    expect(tweet.media[0]).toEqual(expect.objectContaining({
      type: MediaType.VIDEO,
      videoUrl: raw.page_info.media_info.mp4_hd_url || raw.page_info.media_info.stream_url_hd,
      imageUrl: raw.page_info.page_pic,
      duration: raw.page_info.media_info.duration,
    }))
  })

  it('falls back to pic_infos when page_info has no media_info', () => {
    const fixture = loadFixture('mymblog_page1.json')
    const raw = fixture.data.list.find((item: any) => item.pic_ids?.length > 0)

    const tweet = normalizeTweet(raw)

    expect(tweet.media.length).toBeGreaterThan(0)
    expect(tweet.media[0].videoUrl).toBeUndefined()
  })
})
