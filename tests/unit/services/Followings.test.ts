import type { FollowContentResponse } from '~/services/endpoints/follow'
import { readFileSync } from 'node:fs'
import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { followContentSpec } from '~/services/endpoints/follow'
import { FollowingsService } from '~/services/public/FollowingsService'

describe('followings/friends', () => {
  const fixture = {
    users: [{
      id: 123,
      idstr: '123',
      screen_name: 'test',
      name: 'Test',
      location: 'BJ',
      description: 'd',
      profile_image_url: 'https://x.jpg',
      avatar_hd: 'https://x.jpg',
      avatar_large: 'https://x.jpg',
      follow_me: false,
      following: true,
      followers_count: 100,
      friends_count: 50,
      statuses_count: 200,
      verified: true,
      verified_type: 0,
      verified_reason: 'v',
      gender: 'm',
    }],
    next_cursor: 20,
    previous_cursor: 0,
    total_number: 176,
    ok: 1,
  }

  it('calls friendships/friends with correct params', async () => {
    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/friendships/friends')
      return fixture
    })
    const service = new FollowingsService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )
    const data = await service.getFollowings('111', 0)
    expect(data.ok).toBe(1)
    expect(data.users[0].screen_name).toBe('test')
    expect(getLastConfig()?.params).toEqual({ uid: '111', page: 0 })
    expect(getLastConfig()?.headers?.referer).toBe('https://weibo.com/u/111')
  })

  it('works without optional page', async () => {
    const { transport, getLastConfig } = createFakeAxios(async () => fixture)
    const service = new FollowingsService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )
    await service.getFollowings('222')
    expect(getLastConfig()?.params).toEqual({ uid: '222' })
  })
})

describe('followContent', () => {
  const fixture = {
    ok: 1,
    data: {
      follows: {
        users: [{
          id: 456,
          idstr: '456',
          screen_name: 'my',
          name: 'My',
          location: 'SH',
          description: '',
          profile_image_url: 'https://y.jpg',
          avatar_hd: 'https://y.jpg',
          avatar_large: 'https://y.jpg',
          follow_me: true,
          following: true,
          followers_count: 200,
          friends_count: 100,
          statuses_count: 50,
          verified: false,
          verified_type: -1,
          verified_reason: '',
          gender: 'f',
        }],
        next_cursor: 50,
        total_number: 227,
      },
      specialAttention: null, // 真实形态：分组对象或缺失（见 fixture 回归用例），非 array
      total_number: 227,
    },
  }

  it('calls followContent with correct params', async () => {
    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/profile/followContent')
      return fixture
    })
    const service = new FollowingsService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )
    const data = await service.getMyFollowings(0)
    expect(data.ok).toBe(1)
    expect(data.data.follows.users[0].screen_name).toBe('my')
    expect(getLastConfig()?.params).toEqual({ page: 0 })
    expect(getLastConfig()?.headers?.referer).toBe('https://weibo.com/')
  })

  it('works without optional page', async () => {
    const { transport, getLastConfig } = createFakeAxios(async () => fixture)
    const service = new FollowingsService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )
    await service.getMyFollowings()
    expect(getLastConfig()?.params).toEqual({})
  })

  it('validates real followContent fixtures against schema (offline contract regression)', () => {
    // 真实样本三变种（E5 抓出的漂移）：p1 的 specialAttention 是「特别关注」分组对象
    // （{ name, users, list_id }），p2/p3 该键缺失 —— 均非 array
    const p1 = JSON.parse(readFileSync('tests/fixtures/raw/followContent.json', 'utf8'))
    const p2 = JSON.parse(readFileSync('tests/fixtures/raw/followContent_p2.json', 'utf8'))
    const p3 = JSON.parse(readFileSync('tests/fixtures/raw/followContent_p3.json', 'utf8'))

    const parsed1 = followContentSpec.schema.parse(p1) as FollowContentResponse
    expect(parsed1.data.specialAttention?.name).toBe('特别关注')
    expect((parsed1.data.specialAttention?.users ?? []).length).toBeGreaterThan(0)

    const parsed2 = followContentSpec.schema.parse(p2)
    expect(parsed2.data.specialAttention).toBeUndefined()

    const parsed3 = followContentSpec.schema.parse(p3)
    expect(parsed3.data.specialAttention).toBeUndefined()
  })
})
