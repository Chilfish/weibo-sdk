import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { TweetService } from '~/services/public/TweetService'

describe('searchProfile', () => {
  const fixture = {
    ok: 1,
    data: {
      list: [{
        id: 1,
        idstr: '1',
        mblogid: 'Abc',
        mid: 'm1',
        created_at: '2024-01-01',
        text: 'hi',
        text_raw: 'hi',
        source: 'iPhone',
        visible: { type: 0, list_id: 0 },
        user: {
          id: 100,
          idstr: '100',
          screen_name: 'u',
          avatar_hd: '',
          avatar_large: '',
          profile_image_url: '',
          verified: false,
          verified_type: -1,
        },
        attitudes_count: 10,
        comments_count: 5,
        reposts_count: 2,
      }],
      total: 185,
      absstr: '2024 range',
    },
  }

  it('calls searchProfile with correct params', async () => {
    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/statuses/searchProfile')
      return fixture
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )
    const data = await service.searchByDate('111', {
      page: 1,
      starttime: '2024-01-01',
      endtime: '2024-12-31',
    })
    expect(data.ok).toBe(1)
    expect(data.data.list[0].mblogid).toBe('Abc')
    const cfg = getLastConfig()
    expect(cfg?.params?.uid).toBe('111')
    expect(cfg?.params?.page).toBe(1)
    expect(cfg?.params?.starttime).toBe('2024-01-01')
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/111')
  })

  it('works with minimal params', async () => {
    const { client, getLastConfig } = createFakeAxios(async () => fixture)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )
    await service.searchByDate('222')
    expect(getLastConfig()?.params).toEqual({ uid: '222' })
  })

  it('passes unix-second date range params without stringifying', async () => {
    const { client, getLastConfig } = createFakeAxios(async () => fixture)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )
    await service.searchByDate('444', {
      page: 2,
      starttime: 1735689600,
      endtime: 1738368000,
    })
    const params = getLastConfig()?.params
    expect(typeof params?.starttime).toBe('number')
    expect(params?.starttime).toBe(1735689600)
    expect(params?.endtime).toBe(1738368000)
  })

  it('passes filter params', async () => {
    const { client, getLastConfig } = createFakeAxios(async () => fixture)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )
    await service.searchByDate('333', { hasori: 1, haspic: 1 })
    expect(getLastConfig()?.params?.hasori).toBe(1)
    expect(getLastConfig()?.params?.haspic).toBe(1)
  })
})
