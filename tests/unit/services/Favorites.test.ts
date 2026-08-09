import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { FavoriteService } from '~/services/public/FavoriteService'

describe('favorites/all_fav', () => {
  // 真实 API：data 为对象，微博列表在 data.status（见 fixtures/raw/favorites_p1.json）
  const fixture = {
    ok: 1,
    data: {
      status: [{
        id: 1,
        idstr: '1',
        mblogid: 'F001',
        mid: 'm1',
        created_at: '2024-01-01',
        text: 'fav',
        text_raw: 'fav',
        source: 'Android',
        visible: { type: 0, list_id: 0 },
        user: {
          id: 100,
          idstr: '100',
          screen_name: 'author',
          avatar_hd: '',
          avatar_large: '',
          profile_image_url: '',
          verified: true,
          verified_type: 0,
        },
        attitudes_count: 20,
        comments_count: 10,
        reposts_count: 5,
        pic_ids: [],
        pic_infos: {},
      }],
    },
  }

  it('calls favorites/all_fav with correct params', async () => {
    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/favorites/all_fav')
      return fixture
    })
    const service = new FavoriteService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )
    const data = await service.getFavorites('111', 1)
    expect(data.ok).toBe(1)
    expect(data.data.status[0].mblogid).toBe('F001')
    expect(getLastConfig()?.params).toEqual({ uid: '111', page: 1, with_total: true })
    expect(getLastConfig()?.headers?.referer).toBe('https://weibo.com/u/111')
  })

  it('works without optional page', async () => {
    const { client, getLastConfig } = createFakeAxios(async () => fixture)
    const service = new FavoriteService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )
    await service.getFavorites('222')
    expect(getLastConfig()?.params).toEqual({ uid: '222', with_total: true })
  })

  it('handles retweeted_status', async () => {
    const fixtureRT = {
      ok: 1,
      data: {
        status: [{
          ...fixture.data.status[0],
          retweeted_status: {
            id: 2,
            idstr: '2',
            mblogid: 'RT001',
            mid: 'm2',
            created_at: '2024-01-02',
            text: 'rt',
            source: '',
            visible: { type: 0, list_id: 0 },
            user: {
              id: 200,
              idstr: '200',
              screen_name: 'rta',
              avatar_hd: '',
              avatar_large: '',
              profile_image_url: '',
              verified: false,
              verified_type: -1,
            },
          },
        }],
      },
    }
    const { client } = createFakeAxios(async () => fixtureRT)
    const service = new FavoriteService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )
    const data = await service.getFavorites('111')
    expect(data.data.status[0].retweeted_status!.mblogid).toBe('RT001')
  })
})
