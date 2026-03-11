import type { IUserDetailsResponse } from '~/types/raw/user/Details'
import type { IUserInfoResponse } from '~/types/raw/user/Info'
import { createFakeAxios } from 'tests/testkit/fakeAxios'
import { describe, expect, it, vi } from 'vitest'
import { UserService } from '~/services/public/UserService'

describe('userService', () => {
  it('calls info endpoint with correct params and triggers onFetched', async () => {
    const response = {
      ok: 1,
      data: { user: { id: 1, idstr: '1' }, tabList: [], blockText: '' },
    } as any as IUserInfoResponse

    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/profile/info')
      return response
    })

    const service = new UserService(
      { cookie: 'SUB=abc; XSRF-TOKEN=token' },
      { client, rateLimitService: { acquire: vi.fn() } as any },
    )

    service.onFetched = vi.fn()

    const data = await service.info('111')
    expect(data.ok).toBe(1)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '111' })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/111')
    expect(service.onFetched).toHaveBeenCalledWith('USER_INFO', response)
  })

  it('calls details endpoint with correct params and triggers onFetched', async () => {
    const response = {
      ok: 1,
      data: { created_at: 'x', desc_text: '' },
    } as any as IUserDetailsResponse

    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/profile/detail')
      return response
    })

    const service = new UserService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: { acquire: vi.fn() } as any },
    )

    service.onFetched = vi.fn()

    const data = await service.details('222')
    expect(data.ok).toBe(1)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '222' })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/222')
    expect(service.onFetched).toHaveBeenCalledWith('USER_DETAILS', response)
  })

  it('getById fetches info + details and returns a User', async () => {
    const infoResponse = {
      ok: 1,
      data: {
        user: {
          id: 111,
          idstr: '111',
          screen_name: 'sn',
          avatar_hd: 'hd',
          avatar_large: '',
          profile_image_url: '',
          profile_url: '/u/111',
          cover_image_phone: '',
          verified: false,
          verified_type: 0,
          verified_reason: '',
          description: '',
          location: '',
          gender: '',
          followers_count: 0,
          friends_count: 0,
          statuses_count: 0,
        },
        tabList: [],
        blockText: '',
      },
    } as any as IUserInfoResponse

    const detailsResponse = {
      ok: 1,
      data: {
        created_at: 'x',
        desc_text: 'desc',
        ip_location: 'IP属地：上海',
        gender: 'n',
        description: '',
        education: { school: '' },
        sunshine_credit: { level: '0' },
        followers: { total_number: 0, users: [] },
        label_desc: [],
        verified_url: '',
        friend_info: '',
        links: [],
      },
    } as any as IUserDetailsResponse

    const { client } = createFakeAxios(async (cfg) => {
      if (cfg.url === 'https://weibo.com/ajax/profile/info')
        return infoResponse
      if (cfg.url === 'https://weibo.com/ajax/profile/detail')
        return detailsResponse
      throw new Error(`unexpected url: ${cfg.url}`)
    })

    const service = new UserService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: { acquire: vi.fn() } as any },
    )

    const user = await service.getById('111')
    expect(user.id).toBe('111')
    expect(user.name).toBe('sn')
  })
})
