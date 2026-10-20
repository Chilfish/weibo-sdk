import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { friendstimelineSpec } from '~/services/endpoints/tweet'

async function loadFixture(name: string): Promise<any> {
  const url = new URL(`../../fixtures/raw/${name}`, import.meta.url)
  return JSON.parse(await readFile(url, 'utf8'))
}

describe('friendstimeline endpoint schema', () => {
  it.each([
    ['feed_home.json', 25],
    ['feed_latest_p1.json', 25],
    ['feed_latest_p2.json', 25],
    ['feed_latest_incremental.json', 3],
    ['feed_latest_end.json', 0],
  ])('validates real fixture %s (%i statuses)', async (file, count) => {
    const raw = await loadFixture(file)
    const result = friendstimelineSpec.schema.safeParse(raw)
    if (!result.success)
      console.error(result.error.issues.slice(0, 5))

    expect(result.success).toBe(true)
    expect(result.data!.ok).toBe(1)
    expect(result.data!.statuses).toHaveLength(count)
  })

  it('accepts max_id as number or string and end-page zeros', async () => {
    const page = await loadFixture('feed_latest_p1.json')
    expect(typeof page.max_id).toBe('number')

    const end = await loadFixture('feed_latest_end.json')
    const result = friendstimelineSpec.schema.safeParse(end)
    expect(result.success).toBe(true)
    expect(result.data!.max_id).toBe(0)
  })

  it('all feed items normalize without error', async () => {
    const raw = await loadFixture('feed_latest_p1.json')
    const { normalizeTweet } = await import('~/models/data/Tweet')

    for (const item of raw.statuses) {
      const tweet = normalizeTweet(item)
      expect(tweet.id).toBeTruthy()
      expect(tweet.mblogId).toBeTruthy()
      expect(tweet.user.id).toBeTruthy()
    }
  })
})
