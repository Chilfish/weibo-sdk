import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { FollowingsService } from '~/services/public/FollowingsService'

function mkUser(id: string) {
  return { id, idstr: id, screen_name: `u${id}` }
}

function createService(handler: Parameters<typeof createFakeAxios>[0]) {
  const { transport } = createFakeAxios(handler)
  return new FollowingsService(
    { cookie: 'SUB=abc' },
    { transport, rateLimitService: new NoopRateLimitService() as any },
  )
}

describe('followings streams', () => {
  it('streams followings across pages with dedupe and progress', async () => {
    const progress: any[] = []
    const service = createService(async (config) => {
      expect(config.url).toBe('https://weibo.com/ajax/friendships/friends')
      if (config.params.page === 1)
        return { ok: 1, users: [mkUser('1'), mkUser('2')], total_number: 3 }
      return { ok: 1, users: [mkUser('2'), mkUser('3')], total_number: 3 }
    })

    const out: string[] = []
    for await (const user of service.streamFollowings('111', {
      onProgress: (p) => { progress.push(p) },
    })) {
      out.push(String(user.idstr ?? user.id))
    }

    expect(out).toEqual(['1', '2', '3'])
    expect(progress).toHaveLength(2)
    expect(progress[0]).toMatchObject({
      uid: '111',
      source: 'following',
      page: 1,
      processed: 2,
      total: 3,
    })
  })

  it('streams fans with relate=fans', async () => {
    const service = createService(async (config) => {
      expect(config.params.relate).toBe('fans')
      if (config.params.page === 1)
        return { ok: 1, users: [mkUser('1')], total_number: 1 }
      return { ok: 1, users: [], total_number: 1 }
    })

    const out: string[] = []
    for await (const user of service.streamFans('111'))
      out.push(String(user.idstr ?? user.id))

    expect(out).toEqual(['1'])
  })

  it('streams my followings from followContent', async () => {
    const service = createService(async (config) => {
      expect(config.url).toBe('https://weibo.com/ajax/profile/followContent')
      if (config.params.page === 1) {
        return {
          ok: 1,
          data: { follows: { users: [mkUser('1')], total_number: 1 } },
        }
      }
      return { ok: 1, data: { follows: { users: [], total_number: 1 } } }
    })

    const out: string[] = []
    for await (const user of service.streamMyFollowings())
      out.push(String(user.idstr ?? user.id))

    expect(out).toEqual(['1'])
  })

  it('stops when upstream repeats the same page', async () => {
    let calls = 0
    const service = createService(async () => {
      calls += 1
      return { ok: 1, users: [mkUser('1')], total_number: 100 }
    })

    const out: string[] = []
    for await (const user of service.streamFollowings('111', { maxPages: 5 }))
      out.push(String(user.idstr ?? user.id))

    expect(out).toEqual(['1'])
    expect(calls).toBe(2)
  })
})
