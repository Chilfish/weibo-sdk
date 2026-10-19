import { describe, expect, it } from 'vitest'
import { stripVolatileKeys } from '~/utils/structure'
import { WeiboSDK } from '~/WeiboSDK'

const cookie = process.env.WEIBO_COOKIE

const isE2E = process.env.WEIBO_E2E === '1' && Boolean(cookie)
const describeE2E = isE2E ? describe : describe.skip

describeE2E('snapshot: user profile structure', () => {
  it('info response structure matches', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const raw = await weibo.users.info(userId)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })

  it('detail response structure matches', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const raw = await weibo.users.details(userId)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })

  it('normalized User has valid shape', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const user = await weibo.users.getById(userId)

    expect(typeof user.id).toBe('string')
    expect(typeof user.name).toBe('string')
    expect(typeof user.url).toBe('string')
    expect(user.url).toMatch(/^https:\/\/weibo\.com/)
    expect(typeof user.avatar).toBe('string')
    expect(typeof user.gender).toBe('string')
    expect(['m', 'f', 'n']).toContain(user.gender)
    expect(typeof user.stats.followers).toBe('number')
    expect(typeof user.stats.friends).toBe('number')
    expect(typeof user.stats.statuses).toBe('number')
    expect(user.stats.followers).toBeGreaterThanOrEqual(0)
    expect(user.verification).toBeDefined()
    expect(typeof user.verification.isVerified).toBe('boolean')
  })
})

describeE2E('snapshot: tweet structure', () => {
  // 缓存第一次 mymblog 的结果，避免重复请求
  let cachedMblogIds: string[] | null = null

  async function getFirstMblogIds(): Promise<string[]> {
    if (cachedMblogIds)
      return cachedMblogIds
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const page = await weibo.tweets.listByUserId(userId)
    cachedMblogIds = page.tweets.slice(0, 3).map(t => t.mblogId)
    return cachedMblogIds
  }

  it('mymblog response structure matches', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const raw = await weibo.tweets.myMblog(userId)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })

  it('normalized Tweet list has valid shape', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const page = await weibo.tweets.listByUserId(userId)

    expect(page.tweets.length).toBeGreaterThan(0)
    expect(typeof page.page).toBe('number')
    expect(typeof page.hasMore).toBe('boolean')

    for (const tweet of page.tweets) {
      expect(typeof tweet.id).toBe('string')
      expect(typeof tweet.mblogId).toBe('string')
      expect(typeof tweet.createdAt).toBe('string')
      expect(typeof tweet.text).toBe('string')
      expect(tweet.user).toBeDefined()
      expect(typeof tweet.user.id).toBe('string')
      expect(typeof tweet.user.name).toBe('string')
      expect(typeof tweet.user.avatar).toBe('string')
      expect(typeof tweet.user.verifiedType).toBe('number')
      expect(Array.isArray(tweet.media)).toBe(true)
      expect(tweet.stats.likes).toBeGreaterThanOrEqual(0)
      expect(tweet.stats.comments).toBeGreaterThanOrEqual(0)
      expect(tweet.stats.reposts).toBeGreaterThanOrEqual(0)
    }
  })

  it('statuses/show response structure matches (first tweet from timeline)', async () => {
    const mblogIds = await getFirstMblogIds()
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    for (const mblogId of mblogIds) {
      const raw = await weibo.tweets.show(mblogId, true)
      expect(raw.ok).toBe(1)
      expect(raw.mblogid).toBe(mblogId)
      expect(raw.user).toBeDefined()
      expect(stripVolatileKeys(raw)).toMatchSnapshot()
    }
  })

  it('normalized single tweet has valid shape', async () => {
    const mblogIds = await getFirstMblogIds()
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    for (const mblogId of mblogIds) {
      const tweet = await weibo.tweets.getByMblogId(mblogId)

      expect(typeof tweet.id).toBe('string')
      expect(tweet.mblogId).toBe(mblogId)
      expect(typeof tweet.text).toBe('string')
      expect(tweet.user).toBeDefined()
      expect(Array.isArray(tweet.media)).toBe(true)
      expect(tweet.stats.likes).toBeGreaterThanOrEqual(0)

      if (tweet.retweetedStatus) {
        expect(typeof tweet.retweetedStatus.id).toBe('string')
        expect(typeof tweet.retweetedStatus.mblogId).toBe('string')
        expect(tweet.retweetedStatus.user).toBeDefined()
      }
    }
  })
})

describeE2E('snapshot: SDK lifecycle', () => {
  it('selfCheck succeeds with valid cookie', async () => {
    const weibo = new WeiboSDK({ cookie: cookie! })
    await expect(weibo.selfCheck()).resolves.toBeUndefined()
  })

  it('checkSession returns true', async () => {
    const weibo = new WeiboSDK({ cookie: cookie! })
    expect(await weibo.checkSession()).toBe(true)
  })
})
