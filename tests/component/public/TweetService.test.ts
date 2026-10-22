import type { StatusShowResponse } from '~/services/endpoints/tweet'
import { readFileSync } from 'node:fs'
import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it, vi } from 'vitest'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { myMblogSpec } from '~/services/endpoints/tweet'
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

describe('tweetService', () => {
  it('calls mymblog endpoint with correct params', async () => {
    const response = { ok: 1, data: { since_id: '0', list: [], total: -1 } } as any

    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/statuses/mymblog')
      return response
    })

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const data = await service.fetchRawUserTimelinePage('111', 2, 20)
    expect(data.data.since_id).toBe('0')

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '111', page: 2, count: 20 })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/111')
  })

  it('listByUserId returns normalized Tweet list with page cursor', async () => {
    const response = {
      ok: 1,
      data: {
        since_id: '',
        list: [
          {
            id: 1,
            idstr: '1',
            mblogid: 'x',
            created_at: 'now',
            text: '',
            text_raw: 'plain',
            region_name: '',
            source: '',
            visible: { type: 0, list_id: 0 },
            attitudes_count: 0,
            comments_count: 0,
            reposts_count: 0,
            user: {
              id: 2,
              idstr: '2',
              screen_name: 'u',
              avatar_hd: '',
              avatar_large: '',
              profile_image_url: '',
              verified: false,
              verified_type: 0,
            },
          },
        ],
        total: -1,
      },
    } as any

    const { transport, getLastConfig } = createFakeAxios(async () => response)
    const telemetry = { emit: vi.fn(async () => {}) }
    const service = new TweetService(
      { cookie: 'SUB=abc', telemetry },
      { transport, rateLimitService: new NoopRateLimitService() as any, telemetry },
    )

    const page = await service.listByUserId('111')
    expect(page.page).toBe(2) // 第一页 → 下一页页码
    expect(page.hasMore).toBe(true)
    expect(page.tweets).toHaveLength(1)
    expect(page.tweets[0].id).toBe('1')
    expect(getLastConfig()?.params).toEqual({ uid: '111' })

    expect(telemetry.emit).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'normalize_done',
      model: 'Tweet',
      count: 1,
      duration_ms: expect.any(Number),
    }))
  })

  it('listByUserId filters out ad items (isAd) from the feed', async () => {
    const mk = (mblogid: string, extra: Record<string, unknown> = {}) => ({
      id: 1,
      idstr: mblogid,
      mblogid,
      created_at: 'now',
      text: '',
      text_raw: 't',
      visible: { type: 0, list_id: 0 },
      user: { id: 2, idstr: '2', screen_name: 'u' },
      ...extra,
    })
    const response = {
      ok: 1,
      data: {
        since_id: '',
        list: [mk('A'), mk('AD1', { isAd: true }), mk('B')],
        total: -1,
      },
    } as any

    const { transport } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.listByUserId('111')
    expect(page.tweets.map(t => t.mblogId)).toEqual(['A', 'B'])
  })

  it('listByUserId returns hasMore=false when page is empty (end of feed)', async () => {
    const response = {
      ok: 1,
      data: { since_id: '', list: [], total: -1 },
    } as any

    const { transport } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.listByUserId('111', { page: 999 })
    expect(page.hasMore).toBe(false)
    expect(page.tweets).toHaveLength(0)
  })

  it('listByUserId sends page param and returns next page number', async () => {
    const response = {
      ok: 1,
      data: {
        since_id: '',
        list: [
          {
            id: 1,
            idstr: '1',
            mblogid: 'x',
            created_at: 'now',
            text: '',
            text_raw: 'plain',
            region_name: '',
            source: '',
            visible: { type: 0, list_id: 0 },
            user: {
              id: 2,
              idstr: '2',
              screen_name: 'u',
              avatar_hd: '',
              avatar_large: '',
              profile_image_url: '',
              verified: false,
              verified_type: 0,
            },
          },
        ],
        total: -1,
      },
    } as any

    const { transport, getLastConfig } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.listByUserId('111', { page: 3, count: 20 })
    expect(page.page).toBe(4)
    expect(page.hasMore).toBe(true)
    expect(getLastConfig()?.params).toEqual({ uid: '111', page: 3, count: 20 })
  })

  it('streamByUserId paginates across pages via page cursor', async () => {
    const mk = (mblogid: string) => ({
      id: 1,
      idstr: mblogid,
      mblogid,
      created_at: 'now',
      text: '',
      text_raw: 't',
      visible: { type: 0, list_id: 0 },
      user: { id: 2, idstr: '2', screen_name: 'u' },
    })
    // page=1 → 一条；page=2 → 一条；page=3 → 空（到底）
    const { transport } = createFakeAxios(async (cfg) => {
      const page = (cfg.params as any)?.page ?? 1
      if (page === 1)
        return { ok: 1, data: { since_id: '', list: [mk('A')], total: -1 } }
      if (page === 2)
        return { ok: 1, data: { since_id: '', list: [mk('B')], total: -1 } }
      return { ok: 1, data: { since_id: '', list: [], total: -1 } }
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const pulled: string[] = []
    for await (const t of service.streamByUserId('111'))
      pulled.push(t.mblogId)

    expect(pulled).toEqual(['A', 'B'])
  })

  it('listFriendTimeline returns no maxId when the page is empty', async () => {
    const response = {
      ok: 1,
      statuses: [],
      total_number: 2000,
      since_id: 0,
      max_id: 0,
    } as any

    const { transport } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.listFriendTimeline()
    expect(page.maxId).toBeUndefined()
    expect(page.hasMore).toBe(false)
  })

  it('listFriendTimeline uses max_id as the next-page cursor and round-trips it', async () => {
    const response = {
      ok: 1,
      statuses: [
        {
          id: 1,
          idstr: '1',
          mblogid: 'x',
          created_at: 'now',
          text: '',
          text_raw: 'plain',
          region_name: '',
          source: '',
          visible: { type: 0, list_id: 0 },
          user: {
            id: 2,
            idstr: '2',
            screen_name: 'u',
            avatar_hd: '',
            avatar_large: '',
            profile_image_url: '',
            verified: false,
            verified_type: 0,
          },
        },
      ],
      total_number: 2000,
      since_id: 999,
      max_id: 12345,
    } as any

    const { transport, getLastConfig } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.listFriendTimeline({ maxId: '999' })
    expect(page.maxId).toBe('12345')
    expect(page.hasMore).toBe(true)
    expect(page.tweets).toHaveLength(1)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ max_id: '999' })
  })

  it('streamFriendTimeline paginates by max_id and dedupes the inclusive cursor', async () => {
    const progress: any[] = []
    const { transport } = createFakeAxios(async (config) => {
      if (config.params.max_id === undefined) {
        return {
          ok: 1,
          total_number: 2000,
          statuses: [mkTweet('m3'), mkTweet('m2')],
          max_id: 2,
        }
      }
      expect(config.params.max_id).toBe('2')
      return {
        ok: 1,
        total_number: 2000,
        statuses: [mkTweet('m2'), mkTweet('m1')],
        max_id: 0,
      }
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const out: string[] = []
    for await (const tweet of service.streamFriendTimeline({
      onProgress: (p) => { progress.push(p) },
    })) {
      out.push(tweet.mblogId)
    }

    expect(out).toEqual(['m3', 'm2', 'm1'])
    expect(progress).toHaveLength(2)
    expect(progress[1]).toMatchObject({ page: 2, cursor: '2', processed: 3, pageSize: 2, total: 2000 })
  })

  it('streamFriendTimeline with sinceId fetches exactly one incremental page', async () => {
    let calls = 0
    const { transport, getLastConfig } = createFakeAxios(async () => {
      calls += 1
      return {
        ok: 1,
        total_number: 2000,
        statuses: [mkTweet('m9'), mkTweet('m8')],
        max_id: 8,
      }
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const out: string[] = []
    for await (const tweet of service.streamFriendTimeline({ sinceId: '7' }))
      out.push(tweet.mblogId)

    expect(out).toEqual(['m9', 'm8'])
    expect(calls).toBe(1)
    expect(getLastConfig()?.params).toEqual({ since_id: '7' })
  })

  it('streamFriendTimeline honors maxItems without fetching another page', async () => {
    let calls = 0
    const { transport } = createFakeAxios(async () => {
      calls += 1
      return {
        ok: 1,
        total_number: 2000,
        statuses: [mkTweet('m3'), mkTweet('m2')],
        max_id: 2,
      }
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const out: string[] = []
    for await (const tweet of service.streamFriendTimeline({ maxItems: 1 }))
      out.push(tweet.mblogId)

    expect(out).toEqual(['m3'])
    expect(calls).toBe(1)
  })

  it('streamFriendTimeline stops at the since date boundary', async () => {
    const at = (iso: string) => ({ ...mkTweet('m'), created_at: new Date(iso).toUTCString() })
    let calls = 0
    const { transport } = createFakeAxios(async () => {
      calls += 1
      return {
        ok: 1,
        total_number: 2000,
        statuses: [
          { ...at('2026-10-20T00:00:00Z'), mblogid: 'm3', idstr: 'm3' },
          { ...at('2026-10-19T00:00:00Z'), mblogid: 'm2', idstr: 'm2' },
          { ...at('2026-10-18T00:00:00Z'), mblogid: 'm1', idstr: 'm1' },
        ],
        max_id: 2,
      }
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const out: string[] = []
    for await (const tweet of service.streamFriendTimeline({
      since: Date.parse('2026-10-19T00:00:00Z') / 1000,
      maxPages: 5,
    })) {
      out.push(tweet.mblogId)
    }

    expect(out).toEqual(['m3', 'm2'])
    expect(calls).toBe(1)
  })

  it('streamByUserId honors maxItems and since', async () => {
    const mk = (mblogid: string, createdAt: string) => ({
      ...mkTweet(mblogid),
      created_at: new Date(createdAt).toUTCString(),
    })
    let calls = 0
    const { transport } = createFakeAxios(async () => {
      calls += 1
      return {
        ok: 1,
        data: {
          since_id: '',
          list: [mk('A', '2026-10-20T00:00:00Z'), mk('B', '2026-10-18T00:00:00Z')],
          total: -1,
        },
      }
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const out: string[] = []
    for await (const tweet of service.streamByUserId('111', {
      since: Date.parse('2026-10-19T00:00:00Z') / 1000,
      maxPages: 5,
    })) {
      out.push(tweet.mblogId)
    }

    expect(out).toEqual(['A'])
    expect(calls).toBe(1)
  })

  it('listFriendTimeline stops when max_id does not advance', async () => {
    let calls = 0
    const { transport } = createFakeAxios(async () => {
      calls += 1
      return {
        ok: 1,
        total_number: 2000,
        statuses: [mkTweet('m3')],
        max_id: 777,
      }
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const out: string[] = []
    for await (const tweet of service.streamFriendTimeline({ maxId: '777' }))
      out.push(tweet.mblogId)

    expect(out).toEqual(['m3'])
    expect(calls).toBe(1)
  })

  it('getReposts calls repostTimeline with correct params and parses data', async () => {
    const response = {
      ok: 1,
      data: [
        {
          id: 1,
          idstr: '1',
          mblogid: 'QEV9ajb8x',
          created_at: 'now',
          text: '<URL>',
          text_raw: '<URL>',
          user: { id: 2, idstr: '2', screen_name: 'u' },
        },
      ],
      total_number: 10299,
      max_page: 515,
      next_cursor: 5302768680304825,
      empty_tip: '',
    } as any

    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/statuses/repostTimeline')
      return response
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const raw = await service.getReposts('QEV15en4k', { page: 2 })
    expect(raw.data).toHaveLength(1)
    expect(raw.data[0].mblogid).toBe('QEV9ajb8x')
    expect(raw.total_number).toBe(10299)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ id: 'QEV15en4k', page: 2 })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/detail/QEV15en4k')
  })

  it('calls show endpoint with correct params', async () => {
    const response = {
      ok: 1,
      id: 1,
      idstr: '1',
      mid: '1',
      mblogid: 'QqsYymYOS',
      created_at: 'now',
      text: '<span>html</span>',
      text_raw: 'plain',
      visible: { type: 0, list_id: 0 },
      user: {
        id: 2,
        idstr: '2',
        screen_name: 'u',
      },
    } as any as StatusShowResponse

    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/statuses/show')
      return response
    })

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const tweet = await service.getByMblogId('QqsYymYOS', true)
    expect(tweet.mblogId).toBe('QqsYymYOS')
    expect(tweet.text).toBe('plain')

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ id: 'QqsYymYOS', isGetLongText: true })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/detail/QqsYymYOS')
  })

  it('getByMblogId throws WeiboAPINotOkError when ok != 1', async () => {
    const { transport } = createFakeAxios(async () => ({ ok: 0, msg: 'bad id' }))

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(service.getByMblogId('bad')).rejects.toBeInstanceOf(WeiboAPINotOkError)
  })

  it('getByMblogId throws UnexpectedAPIResponseError when schema validation fails', async () => {
    const { transport } = createFakeAxios(async () => ({ ok: 1, mblogid: 'x', user: {} }))

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(service.getByMblogId('x')).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
  })

  it('getByMblogId maps non-JSON HTML response to ProtocolError (login page detection, not API_NOT_OK)', async () => {
    // 端点返回登录页 HTML（如失效/风控）时，应归为协议层错误而非业务失败
    const { transport } = createFakeAxios(async () => '<!doctype html><title>登录 - 微博</title>')

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(service.getByMblogId('x')).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
    await expect(service.getByMblogId('x')).rejects.not.toBeInstanceOf(WeiboAPINotOkError)
  })

  it('getByMblogId returns normalized Tweet', async () => {
    const response = {
      ok: 1,
      id: 1,
      idstr: '1',
      mid: '1',
      mblogid: 'QqsYymYOS',
      created_at: 'now',
      text: '<span>html</span>',
      text_raw: 'plain',
      region_name: '发布于 广东',
      source: '',
      visible: { type: 1, list_id: 0 },
      attitudes_count: 10,
      comments_count: 2,
      reposts_count: 3,
      user: {
        id: 2,
        idstr: '2',
        screen_name: 'u',
        avatar_hd: 'hd',
        verified: true,
        verified_type: 1,
      },
      pic_ids: [],
    } as any as StatusShowResponse

    const { transport } = createFakeAxios(async () => response)
    const telemetry = { emit: vi.fn(async () => {}) }
    const service = new TweetService(
      { cookie: 'SUB=abc', telemetry },
      { transport, rateLimitService: new NoopRateLimitService() as any, telemetry },
    )

    const tweet = await service.getByMblogId('QqsYymYOS')
    expect(tweet.id).toBe('1')
    expect(tweet.mblogId).toBe('QqsYymYOS')
    expect(tweet.text).toBe('plain')
    expect(tweet.regionName).toBe('发布于 广东')
    expect(tweet.user.name).toBe('u')
    expect(tweet.visible).toBe(1)
    expect(tweet.stats).toEqual({ likes: 10, comments: 2, reposts: 3 })

    expect(telemetry.emit).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'normalize_done',
      model: 'Tweet',
      count: 1,
      duration_ms: expect.any(Number),
    }))
  })

  it('enrich returns raw + normalized tweet without changing ITweet v1', async () => {
    const showRaw = {
      ok: 1,
      id: 1,
      idstr: '1',
      mblogid: 'QqsYymYOS',
      created_at: 'now',
      text: '<span>html</span>',
      text_raw: 'plain',
      visible: { type: 0, list_id: 0 },
      user: { id: 2, idstr: '2', screen_name: 'u' },
      unmodeled_field: 'kept-in-raw',
    }

    const { transport, getLastConfig } = createFakeAxios(async () => showRaw)
    const telemetry = { emit: vi.fn(async () => {}) }
    const service = new TweetService(
      { cookie: 'SUB=abc', telemetry },
      { transport, rateLimitService: new NoopRateLimitService() as any, telemetry },
    )

    const result = await service.enrich('QqsYymYOS')

    expect(result.tweet.mblogId).toBe('QqsYymYOS')
    expect(result.tweet.text).toBe('plain')
    // passthrough 字段保留：raw 是下游自行落盘的完整响应
    expect((result.raw as any).unmodeled_field).toBe('kept-in-raw')
    expect(result.longText).toBeUndefined()
    expect(getLastConfig()?.params).toEqual({ id: 'QqsYymYOS', isGetLongText: true })
    expect(telemetry.emit).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'normalize_done',
      model: 'Tweet',
      count: 1,
      duration_ms: expect.any(Number),
    }))
  })

  it('enrich pulls long text only when includeLongText is true', async () => {
    const showRaw = {
      ok: 1,
      id: 1,
      idstr: '1',
      mblogid: 'MB1',
      created_at: 'now',
      text: '',
      text_raw: 'short',
      visible: { type: 0, list_id: 0 },
      user: { id: 2, idstr: '2', screen_name: 'u' },
    }
    const longRaw = { ok: 1, data: { longTextContent: '<p>html</p>', longTextContent_raw: 'plain long' } }
    const calls: Array<{ url?: string, params?: unknown }> = []

    const { transport } = createFakeAxios(async (cfg) => {
      calls.push({ url: cfg.url, params: cfg.params })
      return cfg.url?.endsWith('/longtext') ? longRaw : showRaw
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const result = await service.enrich('MB1', { includeLongText: true, isGetLongText: false })

    expect(result.longText).toBe('plain long')
    expect(calls.map(c => c.url)).toEqual([
      'https://weibo.com/ajax/statuses/show',
      'https://weibo.com/ajax/statuses/longtext',
    ])
    expect(calls[0].params).toEqual({ id: 'MB1', isGetLongText: false })

    calls.length = 0
    await service.enrich('MB1')
    expect(calls.map(c => c.url)).toEqual(['https://weibo.com/ajax/statuses/show'])
  })

  it('starts the long-text request in parallel with statuses/show', async () => {
    const showRaw = {
      ok: 1,
      id: 1,
      idstr: '1',
      mblogid: 'MB1',
      created_at: 'now',
      text: '',
      text_raw: 'short',
      visible: { type: 0, list_id: 0 },
      user: { id: 2, idstr: '2', screen_name: 'u' },
    }
    const longRaw = { ok: 1, data: { longTextContent_raw: 'plain long' } }

    let releaseShow!: () => void
    const showGate = new Promise<void>((resolve) => {
      releaseShow = resolve
    })
    let markLongTextStarted!: () => void
    const longTextStarted = new Promise<void>((resolve) => {
      markLongTextStarted = resolve
    })

    const { transport } = createFakeAxios(async (cfg) => {
      if (cfg.url?.endsWith('/longtext')) {
        markLongTextStarted()
        return longRaw
      }
      await showGate
      return showRaw
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const result = service.enrich('MB1', { includeLongText: true })
    const outcome = await Promise.race([
      longTextStarted.then(() => 'parallel' as const),
      new Promise<'timeout'>(resolve => setTimeout(resolve, 100, 'timeout')),
    ])
    releaseShow()

    expect(outcome).toBe('parallel')
    expect((await result).longText).toBe('plain long')
  })

  it('onRaw receives raw before schema validation (even when parsing fails)', async () => {
    // 缺 id/idstr → 必然 schema 失败
    const raw = { ok: 1, mblogid: 'x', user: {} }
    const onRaw = vi.fn()

    const { transport } = createFakeAxios(async () => raw)
    const service = new TweetService(
      { cookie: 'SUB=abc', hooks: { onRaw } },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(service.getByMblogId('x')).rejects.toBeInstanceOf(UnexpectedAPIResponseError)

    expect(onRaw).toHaveBeenCalledTimes(1)
    expect(onRaw).toHaveBeenCalledWith(raw, expect.objectContaining({
      endpoint: 'ajax/statuses/show',
      resourceType: 'TWEET_SHOW',
      args: { id: 'x', isGetLongText: true },
      request: expect.objectContaining({
        method: 'GET',
        url: 'https://weibo.com/ajax/statuses/show',
      }),
      trace_id: expect.any(String),
      timestamp: expect.any(Number),
    }))
  })

  it('onRaw receives raw before ok-policy rejection', async () => {
    const raw = { ok: 0, msg: 'bad id' }
    const onRaw = vi.fn()

    const { transport } = createFakeAxios(async () => raw)
    const service = new TweetService(
      { cookie: 'SUB=abc', hooks: { onRaw } },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(service.getByMblogId('x')).rejects.toBeInstanceOf(WeiboAPINotOkError)

    expect(onRaw).toHaveBeenCalledWith(raw, expect.objectContaining({
      endpoint: 'ajax/statuses/show',
    }))
  })

  it('comments sends real-browser params and never sends type=feed', async () => {
    const response = { ok: 1, data: [], total_number: 0 } as any

    const { transport, getLastConfig } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await service.comments('MB001', { count: 20 })
    const cfg = getLastConfig()
    expect(cfg?.url).toBe('https://weibo.com/ajax/statuses/buildComments')
    expect(cfg?.params).toEqual({
      id: 'MB001',
      is_reload: 1,
      is_show_bulletin: 2,
      is_mix: 0,
      fetch_level: 0,
      count: 20,
    })
    // 2026-10-20 抓包：带 type=feed 时上游只回 3 条（静默降级），必须不发送。
    expect(cfg?.params).not.toHaveProperty('type')
  })

  it('comments parses all items from the real 20-item fixture (no type=feed regression)', async () => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/raw/comments_no_type_p1.json', 'utf8'))
    const { transport } = createFakeAxios(async () => fixture)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const res = await service.comments('5356101843289999')
    expect(res.data).toHaveLength(20)
    expect(res.total_number).toBe(56)
    expect(res.max_id).toBe(5356111457943584)
    expect(res.trendsText).toBe('已加载全部评论')
  })

  it('comments exposes partial-visibility markers from firewall fixture', async () => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/raw/comments_firewall.json', 'utf8'))
    const { transport } = createFakeAxios(async () => fixture)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const res = await service.comments('5356103541982971')
    expect(res.data.length).toBeLessThan(res.total_number!)
    expect(res.max_id).toBe(0)
    expect(res.trendsText).toContain('防火墙')
  })

  it('comments resolves mblogId to numeric mid when flow=1', async () => {
    const calls: any[] = []
    const { transport } = createFakeAxios(async (cfg) => {
      calls.push(cfg)
      if (cfg.url === 'https://weibo.com/ajax/statuses/show') {
        return {
          ok: 1,
          id: 9001,
          idstr: '9001',
          mblogid: 'MB001',
          user: { id: 2, idstr: '2', screen_name: 'u' },
        }
      }
      return { ok: 1, data: [], total_number: 0 }
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await service.comments('MB001', { flow: 1 })
    expect(calls.map(c => c.url)).toEqual([
      'https://weibo.com/ajax/statuses/show',
      'https://weibo.com/ajax/statuses/buildComments',
    ])
    expect(calls[1].params).toMatchObject({ id: '9001', flow: 1 })
  })

  it('comments keeps numeric id for flow=1 without an extra show request', async () => {
    const calls: any[] = []
    const { transport } = createFakeAxios(async (cfg) => {
      calls.push(cfg)
      return { ok: 1, data: [], total_number: 0 }
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await service.comments('5356101843289999', { flow: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://weibo.com/ajax/statuses/buildComments')
    expect(calls[0].params).toMatchObject({ id: '5356101843289999', flow: 1 })
  })

  it('validates real mymblog fixtures against schema (offline contract regression)', () => {
    const page1 = JSON.parse(readFileSync('tests/fixtures/raw/mymblog_page1.json', 'utf8'))
    const pageEnd = JSON.parse(readFileSync('tests/fixtures/raw/mymblog_page_end.json', 'utf8'))
    const numericCursor = JSON.parse(readFileSync('tests/fixtures/raw/mymblog_page1_since_id_numeric.json', 'utf8'))

    // 有数据页：since_id=""、total=-1（page 分页漂移样本）通过
    const parsed1 = myMblogSpec.schema.parse(page1)
    expect(parsed1.data.list.length).toBeGreaterThan(0)
    expect(parsed1.data.since_id).toBe('')
    expect(parsed1.data.total).toBe(-1)

    // 2026-10-20 漂移样本：since_id 为 number、total 为真实总数，必须通过
    const parsedNumeric = myMblogSpec.schema.parse(numericCursor)
    expect(parsedNumeric.data.list.length).toBeGreaterThan(0)
    expect(typeof parsedNumeric.data.since_id).toBe('number')
    expect(parsedNumeric.data.total).toBeGreaterThan(0)

    // 翻到底页：list 为空、since_id/total 缺省，且必须通过（此前 schema 强制必填会失败）
    const parsedEnd = myMblogSpec.schema.parse(pageEnd)
    expect(parsedEnd.data.list).toHaveLength(0)
    expect(parsedEnd.data.since_id).toBeUndefined()
    expect(parsedEnd.data.total).toBeUndefined()
  })
})
