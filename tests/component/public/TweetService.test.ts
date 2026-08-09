import type { IStatusShowResponse } from '~/types/raw/tweet/show'
import { readFileSync } from 'node:fs'
import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it, vi } from 'vitest'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { myMblogSpec } from '~/services/endpoints/tweet'
import { TweetService } from '~/services/public/TweetService'

describe('tweetService', () => {
  it('calls mymblog endpoint with correct params and triggers onFetched', async () => {
    const response = { ok: 1, data: { since_id: '0', list: [], total: -1 } } as any

    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/statuses/mymblog')
      return response
    })

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    service.onFetched = vi.fn()

    const data = await service.myMblog('111', 2, 20)
    expect(data.data.since_id).toBe('0')

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '111', page: 2, count: 20 })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/111')
    expect(service.onFetched).toHaveBeenCalledWith('TWEET_MYMBLOG', response)
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

    const { client, getLastConfig } = createFakeAxios(async () => response)
    const telemetry = { emit: vi.fn(async () => {}) }
    const service = new TweetService(
      { cookie: 'SUB=abc', telemetry },
      { client, rateLimitService: new NoopRateLimitService() as any, telemetry },
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

  it('listByUserId returns hasMore=false when page is empty (end of feed)', async () => {
    const response = {
      ok: 1,
      data: { since_id: '', list: [], total: -1 },
    } as any

    const { client } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
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

    const { client, getLastConfig } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
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
    const { client } = createFakeAxios(async (cfg) => {
      const page = (cfg.params as any)?.page ?? 1
      if (page === 1)
        return { ok: 1, data: { since_id: '', list: [mk('A')], total: -1 } }
      if (page === 2)
        return { ok: 1, data: { since_id: '', list: [mk('B')], total: -1 } }
      return { ok: 1, data: { since_id: '', list: [], total: -1 } }
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    const pulled: string[] = []
    for await (const t of service.streamByUserId('111'))
      pulled.push(t.mblogId)

    expect(pulled).toEqual(['A', 'B'])
  })

  it('listFriendTimeline returns empty sinceId when no more pages (since_id=-1)', async () => {
    const response = {
      ok: 1,
      statuses: [],
      total_number: 0,
      since_id: -1,
    } as any

    const { client } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.listFriendTimeline()
    expect(page.sinceId).toBe('')
    expect(page.hasMore).toBe(false)
  })

  it('listFriendTimeline keeps since_id as string cursor and rounds-trips it', async () => {
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
      total_number: 10,
      since_id: 12345,
    } as any

    const { client, getLastConfig } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.listFriendTimeline({ since_id: '12345' })
    expect(page.sinceId).toBe('12345')
    expect(page.hasMore).toBe(true)
    expect(page.tweets).toHaveLength(1)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ list_id: '4665452701982436', since_id: '12345' })
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

    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/statuses/repostTimeline')
      return response
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )
    service.onFetched = vi.fn()

    const raw = await service.getReposts('QEV15en4k', { page: 2 })
    expect(raw.data).toHaveLength(1)
    expect(raw.data[0].mblogid).toBe('QEV9ajb8x')
    expect(raw.total_number).toBe(10299)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ id: 'QEV15en4k', page: 2 })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/detail/QEV15en4k')
    expect(service.onFetched).toHaveBeenCalledWith('TWEET_REPOST_TIMELINE', response)
  })

  it('calls show endpoint with correct params and triggers onFetched', async () => {
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
    } as any as IStatusShowResponse

    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/statuses/show')
      return response
    })

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    service.onFetched = vi.fn()

    const data = await service.show('QqsYymYOS', true)
    expect(data.ok).toBe(1)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ id: 'QqsYymYOS', isGetLongText: true })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/detail/QqsYymYOS')
    expect(service.onFetched).toHaveBeenCalledWith('TWEET_SHOW', response)
  })

  it('show throws WeiboAPINotOkError when ok != 1', async () => {
    const { client } = createFakeAxios(async () => ({ ok: 0, msg: 'bad id' }))

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(service.show('bad')).rejects.toBeInstanceOf(WeiboAPINotOkError)
  })

  it('show throws UnexpectedAPIResponseError when schema validation fails', async () => {
    const { client } = createFakeAxios(async () => ({ ok: 1, mblogid: 'x', user: {} }))

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(service.show('x')).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
  })

  it('show maps non-JSON HTML response to ProtocolError (login page detection, not API_NOT_OK)', async () => {
    // 端点返回登录页 HTML（如失效/风控）时，应归为协议层错误而非业务失败
    const { client } = createFakeAxios(async () => '<!doctype html><title>登录 - 微博</title>')

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(service.show('x')).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
    await expect(service.show('x')).rejects.not.toBeInstanceOf(WeiboAPINotOkError)
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
    } as any as IStatusShowResponse

    const { client } = createFakeAxios(async () => response)
    const telemetry = { emit: vi.fn(async () => {}) }
    const service = new TweetService(
      { cookie: 'SUB=abc', telemetry },
      { client, rateLimitService: new NoopRateLimitService() as any, telemetry },
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

  it('comments sends required params (is_reload/type/... )', async () => {
    const response = { ok: 1, data: [], total_number: 0 } as any

    const { client, getLastConfig } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    await service.comments('MB001', { count: 20 })
    const cfg = getLastConfig()
    expect(cfg?.url).toBe('https://weibo.com/ajax/statuses/buildComments')
    expect(cfg?.params).toEqual({
      id: 'MB001',
      is_reload: 1,
      is_show_bulletin: 2,
      is_mix: 0,
      type: 'feed',
      fetch_level: 0,
      count: 20,
    })
  })

  it('validates real mymblog fixtures against schema (offline contract regression)', () => {
    const page1 = JSON.parse(readFileSync('tests/fixtures/raw/mymblog_page1.json', 'utf8'))
    const pageEnd = JSON.parse(readFileSync('tests/fixtures/raw/mymblog_page_end.json', 'utf8'))

    // 有数据页：since_id=""、total=-1（page 分页漂移样本）通过
    const parsed1 = myMblogSpec.schema.parse(page1)
    expect(parsed1.data.list.length).toBeGreaterThan(0)
    expect(parsed1.data.since_id).toBe('')
    expect(parsed1.data.total).toBe(-1)

    // 翻到底页：list 为空、since_id/total 缺省，且必须通过（此前 schema 强制必填会失败）
    const parsedEnd = myMblogSpec.schema.parse(pageEnd)
    expect(parsedEnd.data.list).toHaveLength(0)
    expect(parsedEnd.data.since_id).toBeUndefined()
    expect(parsedEnd.data.total).toBeUndefined()
  })
})
