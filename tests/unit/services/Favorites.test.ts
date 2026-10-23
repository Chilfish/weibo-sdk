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

  function createService(handler: Parameters<typeof createFakeAxios>[0]) {
    const { transport, getLastConfig } = createFakeAxios(handler)
    const service = new FavoriteService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )
    return { service, getLastConfig }
  }

  it('calls favorites/all_fav with correct params', async () => {
    const { service, getLastConfig } = createService(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/favorites/all_fav')
      return fixture
    })

    const data = await service.fetchRawFavorites('111', 1)
    expect(data.ok).toBe(1)
    expect(data.data.status[0].mblogid).toBe('F001')
    expect(getLastConfig()?.params).toEqual({ uid: '111', page: 1, with_total: true })
    expect(getLastConfig()?.headers?.referer).toBe('https://weibo.com/u/111')
  })

  it('listFavorites returns normalized tweets', async () => {
    const { service, getLastConfig } = createService(async () => fixture)

    const page = await service.listFavorites('111', { page: 1 })
    expect(page.tweets).toHaveLength(1)
    expect(page.tweets[0].mblogId).toBe('F001')
    expect(page.tweets[0].user.name).toBe('author')
    expect(page.page).toBe(2)
    expect(getLastConfig()?.params).toEqual({ uid: '111', page: 1, with_total: true })
  })

  it('works without optional page', async () => {
    const { service, getLastConfig } = createService(async () => fixture)

    await service.fetchRawFavorites('222')
    expect(getLastConfig()?.params).toEqual({ uid: '222', with_total: true })
  })

  it('drops invalid page values instead of letting upstream 400', async () => {
    const { service, getLastConfig } = createService(async () => fixture)

    // 上游 page 从 1 开始：page=0 实测返回 HTTP 400，必须按未指定处理
    await service.fetchRawFavorites('333', 0)
    expect(getLastConfig()?.params).toEqual({ uid: '333', with_total: true })

    await service.fetchRawFavorites('333', Number.NaN)
    expect(getLastConfig()?.params).toEqual({ uid: '333', with_total: true })
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
    const { service } = createService(async () => fixtureRT)

    const raw = await service.fetchRawFavorites('111')
    expect(raw.data.status[0].retweeted_status!.mblogid).toBe('RT001')

    const page = await service.listFavorites('111')
    expect(page.tweets[0].retweetedStatus!.mblogId).toBe('RT001')
    expect(page.tweets[0].retweetedStatus!.user.name).toBe('rta')
  })
})
