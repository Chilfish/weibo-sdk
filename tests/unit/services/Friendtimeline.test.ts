import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { friendstimelineSpec } from '~/services/endpoints/tweet'

describe('friendstimeline endpoint schema', () => {
  it('validates real friendstimeline fixture', async () => {
    const url = new URL('../../fixtures/raw/feed_home.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const result = friendstimelineSpec.schema.safeParse(raw)
    if (!result.success)
      console.error(result.error.issues.slice(0, 5))

    expect(result.success).toBe(true)
    expect(result.data!.ok).toBe(1)
    expect(result.data!.statuses.length).toBeGreaterThan(0)
    expect(typeof result.data!.since_id).toBe('number')
  })

  it('all feed items normalize without error', async () => {
    const url = new URL('../../fixtures/raw/feed_home.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const { normalizeTweet } = await import('~/models/data/Tweet')

    for (const item of raw.statuses) {
      const tweet = normalizeTweet(item)
      expect(tweet.id).toBeTruthy()
      expect(tweet.mblogId).toBeTruthy()
      expect(tweet.user.id).toBeTruthy()
    }
  })
})
