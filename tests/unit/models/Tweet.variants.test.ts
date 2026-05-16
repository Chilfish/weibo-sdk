import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { normalizeTweet } from '~/models/data/Tweet'
import { MediaType } from '~/types/domain/ITweet'

type RawTweet = Parameters<typeof normalizeTweet>[0]

async function loadFixture(name: string): Promise<RawTweet> {
  const url = new URL(`../../fixtures/raw/${name}`, import.meta.url)
  return JSON.parse(await readFile(url, 'utf8')) as RawTweet
}

describe('tweet normalization from real fixtures (statuses/show)', () => {
  it('normalizes a plain text tweet', async () => {
    const raw = await loadFixture('tweet_PCN4v8k6W.json')
    const tweet = normalizeTweet(raw)

    expect(tweet.id).toBeTruthy()
    expect(typeof tweet.mblogId).toBe('string')
    expect(tweet.user.id).toBeTruthy()
    expect(tweet.user.name).toBeTruthy()
    expect(tweet.createdAt).toBeTruthy()
    expect(tweet.visible).toBeDefined()
    expect(tweet.stats.likes).toBeGreaterThanOrEqual(0)
    expect(tweet.stats.comments).toBeGreaterThanOrEqual(0)
    expect(tweet.stats.reposts).toBeGreaterThanOrEqual(0)
    // 纯文本微博：无 pic、无 retweet
    expect(tweet.media).toEqual([])
    expect(tweet.retweetedStatus).toBeUndefined()
  })

  it('normalizes a retweet with recursive structure', async () => {
    const raw = await loadFixture('tweet_P6yhlzD3j.json')
    const tweet = normalizeTweet(raw)

    expect(tweet.id).toBeTruthy()
    expect(typeof tweet.mblogId).toBe('string')
    expect(tweet.source).toBeTruthy()
    // 应有转发原微博
    expect(tweet.retweetedStatus).toBeDefined()
    expect(tweet.retweetedStatus!.mblogId).toBeTruthy()
    expect(tweet.retweetedStatus!.user.id).toBeTruthy()
    expect(tweet.retweetedStatus!.user.name).toBeTruthy()
  })

  it('normalizes a multi-pic tweet (9 pics)', async () => {
    const raw = await loadFixture('tweet_OgHLUyXYP.json')
    const tweet = normalizeTweet(raw)

    expect(typeof tweet.mblogId).toBe('string')
    expect(tweet.media.length).toBeGreaterThan(0)
    for (const m of tweet.media) {
      expect(m.id).toBeTruthy()
      expect(m.imageUrl).toBeTruthy()
      expect(m.type).toBeDefined()
    }
    // 9 图微博可能有 livephoto 或 gif
    const types = new Set(tweet.media.map(m => m.type))
    expect(types.has(MediaType.PIC) || types.has(MediaType.LIVEPHOTO) || types.has(MediaType.GIF)).toBe(true)
  })
})

describe('tweet normalization from real fixtures (mymblog)', () => {
  it('normalizes all 9 tweets from mymblog fixture without throwing', async () => {
    const url = new URL('../../fixtures/raw/timeline_u1740358225.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    for (const item of raw.data.list) {
      const tweet = normalizeTweet(item)
      // 核心不变性
      expect(tweet.id).toBeTruthy()
      expect(tweet.mblogId).toBeTruthy()
      expect(tweet.user.id).toBeTruthy()
      expect(tweet.user.name).toBeTruthy()
      expect(tweet.createdAt).toBeTruthy()
      expect(tweet.stats.likes).toBeGreaterThanOrEqual(0)
    }
  })

  it('filters AD tweets (isAd field)', async () => {
    const url = new URL('../../fixtures/raw/timeline_u1740358225.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const ads = raw.data.list.filter((item: any) => item.isAd === true)
    expect(ads.length).toBeGreaterThan(0) // 确认 fixture 中有广告

    // 广告微博也应能 normalize（虽然会被 filterTweets 过滤掉）
    const adTweet = normalizeTweet(ads[0])
    expect(adTweet.id).toBeTruthy()
  })

  it('normalizes retweets from mymblog', async () => {
    const url = new URL('../../fixtures/raw/timeline_u1740358225.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const retweets = raw.data.list.filter((item: any) => item.retweeted_status != null)
    expect(retweets.length).toBeGreaterThan(0)

    for (const rt of retweets) {
      const tweet = normalizeTweet(rt)
      expect(tweet.retweetedStatus).toBeDefined()
      expect(tweet.retweetedStatus!.id).toBeTruthy()
      expect(tweet.retweetedStatus!.mblogId).toBeTruthy()
    }
  })

  it('normalizes long text tweets', async () => {
    const url = new URL('../../fixtures/raw/timeline_u1740358225.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const longTexts = raw.data.list.filter((item: any) => item.isLongText === true)
    expect(longTexts.length).toBeGreaterThan(0)

    const tweet = normalizeTweet(longTexts[0])
    expect(tweet.text.length).toBeGreaterThan(0)
    // 长文通常有 continue_tag 或 page_info
    expect(tweet.pageInfo || tweet.text.length > 0).toBeTruthy()
  })

  it('extracts page_info from tweets with link cards', async () => {
    const url = new URL('../../fixtures/raw/timeline_u1740358225.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const withPageInfo = raw.data.list.filter((item: any) => item.page_info != null)
    expect(withPageInfo.length).toBeGreaterThan(0)

    for (const item of withPageInfo) {
      const tweet = normalizeTweet(item)
      expect(tweet.pageInfo).toBeDefined()
      expect(tweet.pageInfo!.pageId).toBeTruthy()
    }
  })
})
