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

    const raw = await weibo.users.fetchRawInfo(userId)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })

  it('detail response structure matches', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const raw = await weibo.users.fetchRawDetails(userId)
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
  /**
   * 固定 mblogId（来自真实 fixture）：避免「取时间线第一条」导致快照随上游内容漂移。
   * `QqsYymYOS` = 长文 + 视频 + 地理；`P6yhlzD3j` = 转发。
   */
  const STABLE_MBLOG_IDS = ['QqsYymYOS', 'P6yhlzD3j'] as const

  it('mymblog response structure matches', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const raw = await weibo.tweets.fetchRawUserTimelinePage(userId)
    expect(raw.data.list.length).toBeGreaterThan(0)
    // 列表元素随上游内容变化（同端点不同变种微博结构不同），只锁响应信封；
    // 列表项漂移由 Zod schema + 归一化断言覆盖。
    expect(stripVolatileKeys({ ...raw, data: { ...raw.data, list: [] } })).toMatchSnapshot()
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

  it('statuses/show response structure matches (fixed tweets)', async () => {
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    for (const mblogId of STABLE_MBLOG_IDS) {
      const { raw } = await weibo.tweets.enrich(mblogId, { isGetLongText: true })
      expect(raw.ok).toBe(1)
      expect(raw.mblogid).toBe(mblogId)
      expect(raw.user).toBeDefined()
      expect(stripVolatileKeys(raw)).toMatchSnapshot()
    }
  })

  it('normalized single tweet has valid shape', async () => {
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    for (const mblogId of STABLE_MBLOG_IDS) {
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
