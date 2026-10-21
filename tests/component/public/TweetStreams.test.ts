import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { TweetService } from '~/services/public/TweetService'

function mkTweet(mblogid: string) {
  return {
    id: 1,
    idstr: mblogid,
    mblogid,
    created_at: 'Mon Oct 19 12:00:00 +0800 2026',
    text: '',
    text_raw: `text-${mblogid}`,
    user: { id: 2, idstr: '2', screen_name: 'u' },
  }
}

function mkComment(id: string) {
  return {
    id,
    idstr: id,
    created_at: 'Mon Oct 19 12:00:00 +0800 2026',
    text: `<b>${id}</b>`,
    text_raw: id,
    user: { id: 9, idstr: '9', screen_name: 'c' },
  }
}

function createService(handler: Parameters<typeof createFakeAxios>[0]) {
  const { transport, getLastConfig } = createFakeAxios(handler)
  const service = new TweetService(
    { cookie: 'SUB=abc' },
    { transport, rateLimitService: new NoopRateLimitService() as any },
  )
  return { service, getLastConfig }
}

describe('tweet streams', () => {
  it('streamComments follows max_id and dedupes comments', async () => {
    const progress: any[] = []
    const { service, getLastConfig } = createService(async (config) => {
      expect(config.url).toBe('https://weibo.com/ajax/statuses/buildComments')
      if (config.params.max_id === undefined) {
        return { ok: 1, data: [mkComment('C1'), mkComment('C2')], total_number: 3, max_id: 111 }
      }
      expect(config.params.max_id).toBe(111)
      return { ok: 1, data: [mkComment('C2'), mkComment('C3')], total_number: 3, max_id: 0 }
    })

    const out: string[] = []
    for await (const comment of service.streamComments('M1', {
      onProgress: (p) => { progress.push(p) },
    })) {
      out.push(comment.id)
    }

    expect(out).toEqual(['C1', 'C2', 'C3'])
    expect(progress).toHaveLength(2)
    expect(progress[0]).toMatchObject({ mblogId: 'M1', page: 1, processed: 2, total: 3 })
    expect(getLastConfig()?.params.max_id).toBe(111)
  })

  it('streamComments ignores total_number and stops on an empty page', async () => {
    let calls = 0
    const { service } = createService(async () => {
      calls += 1
      if (calls === 1)
        return { ok: 1, data: Array.from({ length: 20 }, (_, i) => mkComment(`A${i}`)), total_number: 115, max_id: 111 }
      if (calls === 2)
        return { ok: 1, data: Array.from({ length: 19 }, (_, i) => mkComment(`B${i}`)), total_number: 115, max_id: 222 }
      if (calls === 3)
        return { ok: 1, data: Array.from({ length: 12 }, (_, i) => mkComment(`C${i}`)), total_number: 115, max_id: 333 }
      return { ok: 1, data: [], total_number: 115, max_id: 444 }
    })

    const out: string[] = []
    for await (const comment of service.streamComments('M1'))
      out.push(comment.id)

    // total_number 含楼中楼（115），实际顶层只有 51 条；空页（max_id 仍非 0）才是结束。
    expect(out).toHaveLength(51)
    expect(calls).toBe(4)
  })

  it('streamComments resolves mblogId only once when flow=1', async () => {
    const urls: string[] = []
    const { service } = createService(async (config) => {
      urls.push(String(config.url))
      if (config.url === 'https://weibo.com/ajax/statuses/show') {
        return {
          ok: 1,
          id: 9001,
          idstr: '9001',
          mblogid: 'MB001',
          user: { id: 2, idstr: '2', screen_name: 'u' },
        }
      }
      if (config.params.max_id === undefined)
        return { ok: 1, data: [mkComment('C1')], total_number: 2, max_id: 111 }
      return { ok: 1, data: [mkComment('C2')], total_number: 2, max_id: 0 }
    })

    const out: string[] = []
    for await (const comment of service.streamComments('MB001', { flow: 1 }))
      out.push(comment.id)

    expect(out).toEqual(['C1', 'C2'])
    expect(urls.filter(url => url.includes('statuses/show'))).toHaveLength(1)
    expect(urls.filter(url => url.includes('buildComments'))).toHaveLength(2)
  })

  it('streamComments stops when max_id does not advance', async () => {
    let calls = 0
    const { service } = createService(async () => {
      calls += 1
      return { ok: 1, data: [mkComment(`C${calls}`)], total_number: 99, max_id: 777 }
    })

    const out: string[] = []
    for await (const comment of service.streamComments('M1', { maxId: 777 }))
      out.push(comment.id)

    expect(out).toEqual(['C1'])
    expect(calls).toBe(1)
  })

  it('streamReposts paginates by page and stops at total', async () => {
    const progress: any[] = []
    const { service } = createService(async (config) => {
      expect(config.url).toBe('https://weibo.com/ajax/statuses/repostTimeline')
      if (config.params.page === 1)
        return { ok: 1, data: [mkTweet('R1'), mkTweet('R2')], total_number: 3 }
      return { ok: 1, data: [mkTweet('R3')], total_number: 3 }
    })

    const out: string[] = []
    for await (const repost of service.streamReposts('M1', {
      onProgress: (p) => { progress.push(p) },
    })) {
      out.push(repost.mblogId)
    }

    expect(out).toEqual(['R1', 'R2', 'R3'])
    expect(progress).toHaveLength(2)
    expect(progress[1]).toMatchObject({ mblogId: 'M1', page: 2, processed: 3, total: 3 })
  })

  it('streamReposts stops when upstream repeats the same page', async () => {
    let calls = 0
    const { service } = createService(async () => {
      calls += 1
      return { ok: 1, data: [mkTweet('R1')], total_number: 100 }
    })

    const out: string[] = []
    for await (const repost of service.streamReposts('M1', { maxPages: 5 }))
      out.push(repost.mblogId)

    expect(out).toEqual(['R1'])
    expect(calls).toBe(2)
  })

  it('replies sends id=<root comment>/is_reply/fetch_level and streams second-level comments (D13)', async () => {
    const { service, getLastConfig } = createService(async () => ({
      ok: 1,
      data: [mkComment('C1'), mkComment('C2')],
      total_number: 2,
      max_id: 0,
    }))

    const out: string[] = []
    for await (const reply of service.streamReplies('M1', 'ROOT1'))
      out.push(reply.id)

    expect(out).toEqual(['C1', 'C2'])
    expect(getLastConfig()?.params).toMatchObject({
      id: 'ROOT1',
      is_reply: 1,
      fetch_level: 1,
      is_reload: 1,
    })
    expect(getLastConfig()?.params).not.toHaveProperty('rootid')
    expect(getLastConfig()?.params).not.toHaveProperty('type')
  })

  it('streamReplies follows response max_id and stops at 0', async () => {
    const { service } = createService(async (config) => {
      if (config.params.max_id === undefined)
        return { ok: 1, data: Array.from({ length: 20 }, (_, i) => mkComment(`P1-${i}`)), total_number: 22, max_id: 111 }
      expect(config.params.max_id).toBe(111)
      return { ok: 1, data: [mkComment('P2-0')], total_number: 22, max_id: 0 }
    })

    const out: string[] = []
    for await (const reply of service.streamReplies('M1', 'ROOT1'))
      out.push(reply.id)

    expect(out).toHaveLength(21)
    expect(out.at(-1)).toBe('P2-0')
  })
})
