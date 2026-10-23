import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { FavoriteService } from '~/services/public/FavoriteService'

function createService(handler: Parameters<typeof createFakeAxios>[0]) {
  const { transport, getLastConfig } = createFakeAxios(handler)
  const service = new FavoriteService(
    { cookie: 'SUB=abc' },
    { transport, rateLimitService: new NoopRateLimitService() as any },
  )
  return { service, getLastConfig }
}

const rawFavoriteItem = {
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
}

describe('favoriteService', () => {
  it('fetchRawTags returns the raw favorites tags response', async () => {
    const response = {
      tags: [],
      total_number: 0,
      unclassified_num: 43,
      fav_total_num: 43,
      ok: 1,
    } as any

    const { service, getLastConfig } = createService(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/favorites/tags')
      return response
    })

    const raw = await service.fetchRawTags()
    expect(raw.tags).toEqual([])
    expect(raw.unclassified_num).toBe(43)

    const cfg = getLastConfig()
    expect(cfg?.headers?.referer).toBe('https://weibo.com/fav')
  })

  it('getTags returns a normalized tag list with total', async () => {
    const response = {
      ok: 1,
      tags: [{ id: 1, name: 'tech' }, { tag_id: '2', title: 'life' }, 'plain', {}],
      total_number: 4,
      unclassified_num: 0,
      fav_total_num: 4,
    } as any

    const { service } = createService(async () => response)

    const result = await service.getTags()
    expect(result).toEqual({
      tags: [
        { id: '1', name: 'tech' },
        { id: '2', name: 'life' },
        { id: 'plain', name: 'plain' },
      ],
      total: 4,
    })
  })

  it('fetchRawFavorites passes uid and page', async () => {
    const response = {
      ok: 1,
      data: { status: [], total_number: 0 },
    } as any

    const { service, getLastConfig } = createService(async () => response)

    const raw = await service.fetchRawFavorites('111', 2)
    expect(raw.ok).toBe(1)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '111', page: 2, with_total: true })
  })

  it('listFavorites returns a normalized page', async () => {
    const response = {
      ok: 1,
      data: { status: [rawFavoriteItem], total_number: 1 },
    } as any

    const { service, getLastConfig } = createService(async () => response)

    const page = await service.listFavorites('111', { page: 2 })
    expect(page.page).toBe(3)
    expect(page.total).toBe(1)
    expect(page.hasMore).toBe(false)
    expect(page.tweets).toHaveLength(1)
    expect(page.tweets[0].mblogId).toBe('F001')
    expect(page.tweets[0].text).toBe('fav')
    expect(page.tweets[0].user.id).toBe('100')
    expect(page.tweets[0].user.name).toBe('author')

    // 归一化路径与 raw 入口共用同一请求参数
    expect(getLastConfig()?.params).toEqual({ uid: '111', page: 2, with_total: true })
    expect(getLastConfig()?.headers?.referer).toBe('https://weibo.com/u/111')
  })
})
