import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { FavoriteService } from '~/services/public/FavoriteService'

describe('favoriteService', () => {
  it('getTags parses favorites tags response', async () => {
    const response = {
      tags: [],
      total_number: 0,
      unclassified_num: 43,
      fav_total_num: 43,
      ok: 1,
    } as any

    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/favorites/tags')
      return response
    })
    const service = new FavoriteService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const raw = await service.getTags()
    expect(raw.tags).toEqual([])
    expect(raw.unclassified_num).toBe(43)

    const cfg = getLastConfig()
    expect(cfg?.headers?.referer).toBe('https://weibo.com/fav')
  })

  it('getFavorites passes uid and page', async () => {
    const response = {
      ok: 1,
      data: { status: [], total_number: 0 },
    } as any

    const { transport, getLastConfig } = createFakeAxios(async () => response)
    const service = new FavoriteService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await service.getFavorites('111', 2)
    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '111', page: 2, with_total: true })
  })
})
