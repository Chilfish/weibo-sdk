import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { Tweet } from '~/models/data/Tweet'

describe('tweet model normalization (statuses/show)', () => {
  it('normalizes sample `show.json`', async () => {
    const fileUrl = new URL('../../fixtures/raw/show.json', import.meta.url)
    const raw = JSON.parse(await readFile(fileUrl, 'utf8'))

    const tweet = new Tweet(raw)

    expect(tweet.id).toBe('5263079145477010')
    expect(tweet.mblogId).toBe('QqsYymYOS')
    expect(tweet.user.name).toBe('Chilfish_')
    expect(tweet.visible).toBe(1)

    expect(tweet.text).toContain('长微博')
    expect(tweet.regionName).toBe('发布于 广东')

    expect(tweet.geo).toEqual({
      longitude: 113.915406,
      latitude: 22.470616,
      address: '招商蛇口邮轮中心',
    })

    expect(tweet.media.length).toBeGreaterThan(0)
  })
})
