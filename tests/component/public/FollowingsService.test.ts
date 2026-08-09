import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { FollowingsService } from '~/services/public/FollowingsService'

describe('followingsService', () => {
  it('getFollowings calls friendships endpoint without relate (default following)', async () => {
    const response = {
      users: [{ id: 1, idstr: '1', screen_name: 'u' }],
      next_cursor: 0,
      previous_cursor: 0,
      total_number: 20,
      ok: 1,
    } as any

    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/friendships/friends')
      return response
    })
    const service = new FollowingsService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    const raw = await service.getFollowings('2365795232', 1)
    expect(raw.users).toHaveLength(1)
    expect(raw.ok).toBe(1)

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

    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/friendships/friends')
      return response
    })
    const service = new FollowingsService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    const raw = await service.getFans('2365795232')
    expect(raw.users[0].screen_name).toBe('一颗很走心')
    expect(raw.total_number).toBe(266)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '2365795232', relate: 'fans' })
  })
})
