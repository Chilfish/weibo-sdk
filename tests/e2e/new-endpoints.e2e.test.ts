import { describe, expect, it } from 'vitest'
import { stripVolatileKeys } from '~/utils/structure'
import { WeiboSDK } from '~/WeiboSDK'

const cookie = process.env.WEIBO_COOKIE

const isE2E = process.env.WEIBO_E2E === '1' && Boolean(cookie)
const describeE2E = isE2E ? describe : describe.skip

describeE2E('snapshot: /ajax/statuses/longtext', () => {
  it('longtext structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const page = await weibo.tweets.myMblog(userId)
    const longTweet = page.data.list.find((t: any) => t.isLongText)
    if (!longTweet)
      return
    const raw = await weibo.tweets.longText(longTweet.mblogid)
    expect(raw.ok).toBe(1)
    expect(raw.data.longTextContent).toBeTruthy()
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/friendships/friends', () => {
  it('friendships structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const raw = await weibo.followings.getFollowings(userId)
    expect(raw.ok).toBe(1)
    expect(Array.isArray(raw.users)).toBe(true)
    expect(raw.users.length).toBeGreaterThan(0)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/profile/followContent', () => {
  it('followContent structure snapshot', async () => {
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const raw = await weibo.followings.getMyFollowings()
    expect(raw.ok).toBe(1)
    expect(raw.data.follows.users.length).toBeGreaterThan(0)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/statuses/searchProfile', () => {
  it('searchProfile structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const raw = await weibo.tweets.searchByDate(userId, { page: 1 })
    expect(raw.ok).toBe(1)
    expect(Array.isArray(raw.data.list)).toBe(true)
    expect(raw.data.list.length).toBeGreaterThan(0)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/favorites/all_fav', () => {
  it('favorites structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const raw = await weibo.favorites.getFavorites(userId)
    expect(raw.ok).toBe(1)
    expect(Array.isArray(raw.data.status)).toBe(true)
    expect(raw.data.status.length).toBeGreaterThan(0)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})
