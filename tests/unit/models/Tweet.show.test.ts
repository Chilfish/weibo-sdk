import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { Tweet } from '~/models/data/Tweet'

describe('tweet model normalization (statuses/show)', () => {
  it('normalizes sample `show.json`', async () => {
    const fileUrl = new URL('../../fixtures/raw/tweet_QqsYymYOS.json', import.meta.url)
    const raw = JSON.parse(await readFile(fileUrl, 'utf8'))

    const tweet = new Tweet(raw)

    expect(typeof tweet.id).toBe('string')
    expect(typeof tweet.mblogId).toBe('string')
    expect(typeof tweet.user.name).toBe('string')
    expect(typeof tweet.visible).toBe('number')

    expect(typeof tweet.text).toBe('string')

    expect(tweet.geo).toBeDefined()
    if (tweet.geo) {
      expect(typeof tweet.geo.longitude).toBe('number')
      expect(typeof tweet.geo.latitude).toBe('number')
      expect(Math.abs(tweet.geo.latitude)).toBeLessThanOrEqual(90)
    }

    expect(tweet.media.length).toBeGreaterThan(0)
  })
})
