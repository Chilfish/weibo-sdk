import type { UserBrief } from '~/types'
import { describe, expect, it } from 'vitest'
import { stripVolatileKeys } from '~/utils/structure'
import { WeiboSDK } from '~/WeiboSDK'

const cookie = process.env.WEIBO_COOKIE

const isE2E = process.env.WEIBO_E2E === '1' && Boolean(cookie)
const describeE2E = isE2E ? describe : describe.skip

/**
 * 固定长文 mblogId（来自 `mymblog_page1.json` 的 continue_tag 条目），避免随第一条时间线变化。
 */
const LONG_TEXT_MBLOG_ID = 'RcbHecsos'

function createSdk(): WeiboSDK {
  return new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
}

/**
 * 归一化结果不应再带上游信封与 snake_case 字段。
 *
 * 只查顶层键：领域模型的嵌套对象（`user` / `stats` / `tweets[]` …）由各自的断言覆盖。
 */
function expectNoRawEnvelope(value: object): void {
  expect(value).not.toHaveProperty('ok')
  expect(value).not.toHaveProperty('data')
  for (const key of Object.keys(value))
    expect(key).not.toMatch(/_/)
}

/**
 * `UserBrief` 结构断言（关注 / 粉丝 / 特别关注共用）。
 */
function expectUserBrief(user: UserBrief): void {
  expect(typeof user.id).toBe('string')
  expect(user.id.length).toBeGreaterThan(0)
  expect(typeof user.name).toBe('string')
  expect(typeof user.avatar).toBe('string')
  expect(user.url).toMatch(/^https:\/\/weibo\.com\//)
  expect(['m', 'f', 'n']).toContain(user.gender)
  expect(typeof user.stats.followers).toBe('number')
  expect(typeof user.stats.friends).toBe('number')
  expect(typeof user.stats.statuses).toBe('number')
  expect(typeof user.verified).toBe('boolean')
  expect(typeof user.verifiedType).toBe('number')
  // 上游 raw 字段不应泄漏到归一化模型
  expect(user).not.toHaveProperty('screen_name')
  expect(user).not.toHaveProperty('followers_count')
  expect(user).not.toHaveProperty('idstr')
}

/**
 * 上游 raw 形状快照：只锁 `fetchRaw*` 的信封（Zod 已保证的 snake_case 协议），
 * 用来发现上游漂移；公开方法的归一化输出由下面的 `normalized:` 用例断言。
 */
describeE2E('snapshot: /ajax/statuses/longtext', () => {
  it('longtext structure snapshot', async () => {
    const raw = await createSdk().tweets.fetchRawLongText(LONG_TEXT_MBLOG_ID)
    expect(raw.ok).toBe(1)
    expect(raw.data.longTextContent).toBeTruthy()
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/friendships/friends', () => {
  it('friendships structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const raw = await createSdk().followings.fetchRawFollowings(userId)
    expect(raw.ok).toBe(1)
    expect(Array.isArray(raw.users)).toBe(true)
    expect(raw.users.length).toBeGreaterThan(0)
    // 用户字段持续增加且列表内容会变；只锁响应信封，列表项由 schema / 归一化断言覆盖。
    expect(stripVolatileKeys({ ...raw, users: [] })).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/profile/followContent', () => {
  it('followContent structure snapshot', async () => {
    const raw = await createSdk().followings.fetchRawMyFollowings()
    expect(raw.ok).toBe(1)
    expect(raw.data.follows.users.length).toBeGreaterThan(0)
    expect(stripVolatileKeys({
      ...raw,
      data: { ...raw.data, follows: { ...raw.data.follows, users: [] } },
    })).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/statuses/searchProfile', () => {
  it('searchProfile structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const raw = await createSdk().tweets.fetchRawSearchByDate(userId, { page: 1 })
    expect(raw.ok).toBe(1)
    expect(Array.isArray(raw.data.list)).toBe(true)
    expect(raw.data.list.length).toBeGreaterThan(0)
    expect(stripVolatileKeys({ ...raw, data: { ...raw.data, list: [] } })).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/favorites/all_fav', () => {
  it('favorites structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const raw = await createSdk().favorites.fetchRawFavorites(userId)
    expect(raw.ok).toBe(1)
    expect(Array.isArray(raw.data.status)).toBe(true)
    expect(raw.data.status.length).toBeGreaterThan(0)
    expect(stripVolatileKeys({ ...raw, data: { ...raw.data, status: [] } })).toMatchSnapshot()
  })
})

/**
 * 公开方法的归一化 camelCase 契约（不再是上游信封 `ok` / `data`）。
 */
describeE2E('normalized: public camelCase output', () => {
  it('tweets.longText returns { text, isMarkdown? }', async () => {
    const longText = await createSdk().tweets.longText(LONG_TEXT_MBLOG_ID)

    expect(typeof longText.text).toBe('string')
    expect(longText.text.length).toBeGreaterThan(0)
    if (longText.isMarkdown !== undefined)
      expect(typeof longText.isMarkdown).toBe('boolean')
    expectNoRawEnvelope(longText)
    // 上游字段名不再出现
    expect(longText).not.toHaveProperty('longTextContent')
    expect(longText).not.toHaveProperty('longTextContent_raw')
  })

  it('followings.getFollowings returns { users, cursor?, hasMore, total? }', async () => {
    const { userId } = await import('tests/utils')
    const page = await createSdk().followings.getFollowings(userId)

    expect(Array.isArray(page.users)).toBe(true)
    expect(page.users.length).toBeGreaterThan(0)
    expect(typeof page.hasMore).toBe('boolean')
    if (page.cursor !== undefined)
      expect(typeof page.cursor).toBe('number')
    if (page.total !== undefined)
      expect(typeof page.total).toBe('number')
    // 特别关注只由 getMyFollowings 下发
    expect(page).not.toHaveProperty('specialAttention')
    expectNoRawEnvelope(page)

    for (const user of page.users.slice(0, 3))
      expectUserBrief(user)
  })

  it('followings.getMyFollowings returns { users, specialAttention?, cursor?, hasMore, total? }', async () => {
    const page = await createSdk().followings.getMyFollowings()

    expect(Array.isArray(page.users)).toBe(true)
    expect(page.users.length).toBeGreaterThan(0)
    expect(typeof page.hasMore).toBe('boolean')
    if (page.cursor !== undefined)
      expect(typeof page.cursor).toBe('number')
    if (page.total !== undefined)
      expect(typeof page.total).toBe('number')
    if (page.specialAttention !== undefined) {
      expect(Array.isArray(page.specialAttention)).toBe(true)
      if (page.specialAttention.length > 0)
        expectUserBrief(page.specialAttention[0])
    }
    expectNoRawEnvelope(page)

    for (const user of page.users.slice(0, 3))
      expectUserBrief(user)
  })

  it('tweets.searchByDate returns { tweets, page, total?, hasMore }', async () => {
    const { userId } = await import('tests/utils')
    const page = await createSdk().tweets.searchByDate(userId, { page: 1 })

    expect(Array.isArray(page.tweets)).toBe(true)
    expect(page.tweets.length).toBeGreaterThan(0)
    expect(page.page).toBe(1)
    expect(typeof page.hasMore).toBe('boolean')
    if (page.total !== undefined)
      expect(typeof page.total).toBe('number')
    expectNoRawEnvelope(page)

    const [first] = page.tweets
    expect(typeof first.mblogId).toBe('string')
    expect(first.mblogId.length).toBeGreaterThan(0)
    expect(first).not.toHaveProperty('mblogid')
    expect(first).not.toHaveProperty('created_at')
  })

  it('favorites exposes listFavorites / fetchRawFavorites (getFavorites removed)', async () => {
    const { userId } = await import('tests/utils')
    const weibo = createSdk()

    expect(typeof weibo.favorites.listFavorites).toBe('function')
    expect(typeof weibo.favorites.fetchRawFavorites).toBe('function')
    expect('getFavorites' in weibo.favorites).toBe(false)

    const page = await weibo.favorites.listFavorites(userId, { page: 1 })
    expect(Array.isArray(page.tweets)).toBe(true)
    expect(page.tweets.length).toBeGreaterThan(0)
    // `page` 是「下一页页码」
    expect(page.page).toBe(2)
    expect(typeof page.hasMore).toBe('boolean')
    if (page.total !== undefined)
      expect(typeof page.total).toBe('number')
    if (page.totalPages !== undefined)
      expect(typeof page.totalPages).toBe('number')
    expectNoRawEnvelope(page)

    expect(typeof page.tweets[0].mblogId).toBe('string')
    expect(page.tweets[0]).not.toHaveProperty('mblogid')
  })
})
