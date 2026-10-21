import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import type { AuthContext, Credential } from '~/services/internal/CredentialResolver'
import type { ArchiveServiceDeps } from '~/services/public/ArchiveService'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { ArchiveService } from '~/services/public/ArchiveService'
import { FollowingsService } from '~/services/public/FollowingsService'
import { LikeService } from '~/services/public/LikeService'
import { TweetService } from '~/services/public/TweetService'
import { WeiboSDK } from '~/WeiboSDK'

const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/raw/', import.meta.url))

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}`, 'utf8'))
}

function createAxios(handler: (config: AxiosRequestConfig) => unknown): AxiosInstance {
  return {
    interceptors: {
      request: { use() { return 0 } },
      response: { use() { return 0 }, eject() {}, clear() {} },
    },
    async request(config: AxiosRequestConfig) {
      return { data: handler(config), status: 200, statusText: 'OK', headers: {}, config }
    },
  } as unknown as AxiosInstance
}

const guestCredential: Credential = {
  id: 'guest-primary',
  mode: 'guest',
  async getHeaders() {
    return { Cookie: 'SUB=guest; SUBP=guest' }
  },
  async refresh() {
    return true
  },
}

const guestAuth: AuthContext = {
  mode: 'guest',
  resolver: { resolve: () => guestCredential },
  getCredential: () => guestCredential,
}

const deps = {
  auth: guestAuth,
  rateLimitService: { acquire: async () => {}, pause: () => {} } as any,
}

function serviceFor<T>(
  Service: new (config: { cookie: string }, deps: any) => T,
  handler: (config: AxiosRequestConfig) => unknown,
): T {
  return new Service({ cookie: '' }, { ...deps, client: createAxios(handler) })
}

describe('guest first-page reads (real fixtures)', () => {
  it('normalizes a user timeline from the mobile container and marks it partial', async () => {
    const raw = fixture('mobile_timeline_p1.json')
    const service = serviceFor(TweetService, (config) => {
      expect(String(config.url)).toContain('containerid=1076032365795232')
      return raw
    })

    const page = await service.listByUserId('2365795232')

    expect(page.partial).toBe(true)
    expect(page.hasMore).toBe(false)
    expect(page.page).toBeUndefined()
    expect(page.total).toBe(13718)
    expect(page.tweets.length).toBeGreaterThan(0)
    expect(page.tweets[0].mblogId).toMatch(/^[0-9A-Z]+$/i)
    expect(page.tweets[0].text).not.toBe('')
  })

  it('rejects anonymous page 2 for a user timeline', async () => {
    const service = serviceFor(TweetService, () => fixture('mobile_timeline_p1.json'))

    await expect(service.listByUserId('2365795232', { page: 2 }))
      .rejects
      .toBeInstanceOf(InvalidConfigError)
  })

  it('normalizes likes from the mobile container and marks it partial', async () => {
    const raw = fixture('mobile_likes_p1.json')
    const service = serviceFor(LikeService, (config) => {
      expect(String(config.url)).toContain('containerid=2308692365795232')
      return raw
    })

    const page = await service.listByUserId('2365795232')

    expect(page.partial).toBe(true)
    expect(page.hasMore).toBe(false)
    expect(page.tweets.length).toBeGreaterThan(0)
  })

  it('treats an upstream empty container as an empty likes page', async () => {
    const raw = fixture('mobile_empty_container.json')
    const service = serviceFor(LikeService, (config) => {
      expect(String(config.url)).toContain('containerid=2308691')
      return raw
    })

    const page = await service.listByUserId('1')

    expect(page.partial).toBe(true)
    expect(page.hasMore).toBe(false)
    expect(page.tweets).toEqual([])
  })

  it('reads followings from the followers container (upstream naming is reversed)', async () => {
    const raw = fixture('mobile_followings_p1.json')
    const service = serviceFor(FollowingsService, (config) => {
      expect(String(config.url)).toContain('231051_-_followers_-_2365795232')
      return raw
    })

    const result = await service.getFollowings('2365795232')

    expect(result.ok).toBe(1)
    expect(result.users.length).toBeGreaterThan(0)
    expect(result.total_number).toBe(2385)
    expect(result.next_cursor).toBe(0)
  })

  it('normalizes mobile following users to the friendships field shape', async () => {
    const service = serviceFor(FollowingsService, () => fixture('mobile_followings_p1.json'))

    const result = await service.getFollowings('2365795232')
    const user = result.users[0] as Record<string, unknown>

    expect(user.id).toBe(5662034879)
    expect(user.idstr).toBe('5662034879')
    expect(user.screen_name).toBe('河图阿洛')
    expect(user.name).toBe('河图阿洛')
    expect(user.followers_count).toBe(27000)
    expect(user.friends_count).toBe(26)
    expect(user.statuses_count).toBe(5366)
    expect(user.followers_count_str).toBe('2.7万')
    expect(user.user_token).toBeUndefined()
  })

  it('reads fans from the follows container', async () => {
    const raw = fixture('mobile_fans_p1.json')
    const service = serviceFor(FollowingsService, (config) => {
      expect(String(config.url)).toContain('231051_-_follows_-_2365795232')
      return raw
    })

    const result = await service.getFans('2365795232')

    expect(result.users.length).toBeGreaterThan(0)
    expect(result.next_cursor).toBe(0)
  })

  it('stops followings streams after the first page', async () => {
    const raw = fixture('mobile_followings_p1.json')
    let calls = 0
    const service = serviceFor(FollowingsService, () => {
      calls += 1
      return raw
    })

    const users = []
    for await (const user of service.streamFollowings('2365795232', { maxItems: 3 }))
      users.push(user)

    expect(calls).toBe(1)
    expect(users).toHaveLength(3)
  })
})

describe('guest archive guard', () => {
  const archiveDeps = {
    tweets: { myMblog: vi.fn(), getReposts: vi.fn() },
    favorites: { getFavorites: vi.fn() },
    authMode: 'guest' as const,
  } satisfies ArchiveServiceDeps

  it('refuses a full archive before touching any data source', async () => {
    const archive = new ArchiveService(archiveDeps)

    await expect(async () => {
      for await (const _ of archive.streamArchive('2365795232'))
        void _
    }).rejects.toMatchObject({ code: 'CONFIG_INVALID', context: expect.objectContaining({ authMode: 'guest' }) })

    expect(archiveDeps.tweets.myMblog).not.toHaveBeenCalled()
  })
})

describe('weiboSDK guest session', () => {
  it('does not call myDetails and exposes token metadata only', async () => {
    const sdk = new WeiboSDK({
      auth: 'guest',
      guest: { token: 'SUB=preset; SUBP=preset' },
      selfCheck: { mode: 'none' },
    })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')

    const session = await sdk.getSession()

    expect(session.authMode).toBe('guest')
    expect(session.uid).toBeUndefined()
    expect(session.guestTokenIssuedAt).toEqual(expect.any(Number))
    expect(myDetails).not.toHaveBeenCalled()
    expect(await sdk.getGuestTokenStatus()).toEqual(expect.objectContaining({
      scope: 'all',
      source: 'preset',
    }))
    expect(await sdk.checkSession()).toBe(true)
  })
})
