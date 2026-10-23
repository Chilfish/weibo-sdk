import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { FollowingsService } from '~/services/public/FollowingsService'

describe('followingsService', () => {
  it('getFollowings calls friendships endpoint without relate (default following)', async () => {
    const response = {
      users: [{
        id: 1,
        idstr: '1',
        screen_name: 'u',
        followers_count: 12,
        follow_me: false,
        following: true,
      }],
      next_cursor: 0,
      previous_cursor: 0,
      total_number: 20,
      ok: 1,
    } as any

    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/friendships/friends')
      return response
    })
    const service = new FollowingsService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.getFollowings('2365795232', 1)
    expect(page.users).toHaveLength(1)
    expect(page.users[0]).toMatchObject({
      id: '1',
      name: 'u',
      stats: { followers: 12 },
      following: true,
      followedBy: false,
    })
    // 归一化结果不再携带上游 `ok` 等信封字段
    expect(Object.keys(page).sort()).toEqual(['cursor', 'hasMore', 'total', 'users'])
    expect(page.cursor).toBe(0)
    expect(page.hasMore).toBe(false)
    expect(page.total).toBe(20)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '2365795232', page: 1 })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/2365795232')
  })

  it('getFans passes relate=fans to query followers', async () => {
    const response = {
      users: [{ id: 1, idstr: '1', screen_name: '一颗很走心' }],
      next_cursor: 31,
      total_number: 266,
      ok: 1,
    } as any

    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/friendships/friends')
      return response
    })
    const service = new FollowingsService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.getFans('2365795232')
    expect(page.users[0].name).toBe('一颗很走心')
    expect(page.users[0].url).toBe('https://weibo.com/u/1')
    expect(page.total).toBe(266)
    expect(page.cursor).toBe(31)
    expect(page.hasMore).toBe(true)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '2365795232', relate: 'fans' })
  })

  it('fetchRawFollowings keeps the upstream friendships shape', async () => {
    const response = {
      users: [{ id: 1, idstr: '1', screen_name: 'u' }],
      next_cursor: 20,
      total_number: 20,
      ok: 1,
    } as any

    const { transport } = createFakeAxios(async () => response)
    const service = new FollowingsService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const raw = await service.fetchRawFollowings('2365795232', 1)
    expect(raw.ok).toBe(1)
    expect(raw.users[0].screen_name).toBe('u')
    expect(raw.next_cursor).toBe(20)
    expect(raw.total_number).toBe(20)
  })
})
