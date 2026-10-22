import type { UserDetailsResponse, UserInfoResponse } from '~/services/endpoints/user'
import { createFakeAxios } from 'tests/testkit/fakeAxios'
import { describe, expect, it, vi } from 'vitest'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { UserService } from '~/services/public/UserService'

describe('userService', () => {
  it('calls info endpoint with correct params', async () => {
    const response = {
      ok: 1,
      data: { user: { id: 1, idstr: '1' }, tabList: [], blockText: '' },
    } as any as UserInfoResponse

    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/profile/info')
      return response
    })

    const service = new UserService(
      { cookie: 'SUB=abc; XSRF-TOKEN=token' },
      { transport, rateLimitService: { acquire: vi.fn() } as any },
    )

    const data = await service.fetchRawInfo('111')
    expect(data.ok).toBe(1)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '111' })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/111')
  })

  it('triggers global hooks.onRaw with meta', async () => {
    const response = {
      ok: 1,
      data: { user: { id: 1, idstr: '1' }, tabList: [], blockText: '' },
    } as any as UserInfoResponse

    const { transport } = createFakeAxios(async () => response)

    const onRaw = vi.fn()
    const service = new UserService(
      { cookie: 'SUB=abc', hooks: { onRaw } },
      { transport, rateLimitService: { acquire: vi.fn() } as any },
    )

    await service.fetchRawInfo('111')

    expect(onRaw).toHaveBeenCalledTimes(1)
    expect(onRaw).toHaveBeenCalledWith(response, expect.objectContaining({
      endpoint: 'ajax/profile/info',
      resourceType: 'USER_INFO',
      args: { uid: '111' },
      request: expect.objectContaining({
        method: 'GET',
        url: 'https://weibo.com/ajax/profile/info',
      }),
      trace_id: expect.any(String),
      timestamp: expect.any(Number),
    }))
  })

  it('calls details endpoint with correct params', async () => {
    const response = {
      ok: 1,
      data: { created_at: 'x', desc_text: '' },
    } as any as UserDetailsResponse

    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/profile/detail')
      return response
    })

    const service = new UserService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: { acquire: vi.fn() } as any },
    )

    const data = await service.fetchRawDetails('222')
    expect(data.ok).toBe(1)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '222' })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/222')
  })

  it('calls myDetails endpoint without uid', async () => {
    const response = {
      ok: 1,
      data: { created_at: 'x', desc_text: '' },
    } as any as UserDetailsResponse

    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/profile/detail')
      return response
    })

    const service = new UserService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: { acquire: vi.fn() } as any },
    )

    const data = await service.myDetails()
    expect(data.ok).toBe(1)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({})
    expect(cfg?.headers?.referer).toBe('https://weibo.com/')
  })

  it('myDetails throws WeiboSessionExpiredError when ok != 1', async () => {
    const { transport } = createFakeAxios(async () => ({ ok: 0, msg: 'need login' }))

    const service = new UserService(
      { cookie: 'SUB=expired' },
      { transport, rateLimitService: { acquire: vi.fn() } as any },
    )

    await expect(service.myDetails()).rejects.toBeInstanceOf(WeiboSessionExpiredError)
  })

  it('info throws UnexpectedAPIResponseError when schema validation fails', async () => {
    const { transport } = createFakeAxios(async () => ({ ok: 1, data: {} }))

    const service = new UserService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: { acquire: vi.fn() } as any },
    )

    await expect(service.fetchRawInfo('111')).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
  })

  it('triggers global hooks.onError for ok != 1', async () => {
    const { transport } = createFakeAxios(async () => ({ ok: 0, msg: 'need login' }))

    const onError = vi.fn()
    const service = new UserService(
      { cookie: 'SUB=expired', hooks: { onError } },
      { transport, rateLimitService: { acquire: vi.fn() } as any },
    )

    await expect(service.fetchRawInfo('111')).rejects.toBeDefined()

    expect(onError).toHaveBeenCalledTimes(1)
    const [error, meta] = onError.mock.calls[0]!
    expect(error).toBeInstanceOf(Error)
    expect(meta).toEqual(expect.objectContaining({
      phase: 'response',
      endpoint: 'ajax/profile/info',
      ok: 0,
      message: 'need login',
      args: { uid: '111' },
      trace_id: expect.any(String),
      timestamp: expect.any(Number),
    }))
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
    } as any as UserInfoResponse

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
    } as any as UserDetailsResponse

    const { transport } = createFakeAxios(async (cfg) => {
      if (cfg.url === 'https://weibo.com/ajax/profile/info')
        return infoResponse
      if (cfg.url === 'https://weibo.com/ajax/profile/detail')
        return detailsResponse
      throw new Error(`unexpected url: ${cfg.url}`)
    })

    const telemetry = { emit: vi.fn(async () => {}) }
    const service = new UserService(
      { cookie: 'SUB=abc', telemetry },
      { transport, rateLimitService: { acquire: vi.fn() } as any, telemetry },
    )

    const user = await service.getById('111')
    expect(user.id).toBe('111')
    expect(user.name).toBe('sn')

    expect(telemetry.emit).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'normalize_done',
      model: 'User',
      count: 1,
      duration_ms: expect.any(Number),
    }))
  })
})
