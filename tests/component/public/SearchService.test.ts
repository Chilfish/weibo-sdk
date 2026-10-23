import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { SearchService } from '~/services/public/SearchService'

describe('searchService', () => {
  it('searchUsers maps m.weibo.cn HTML login page to ProtocolError (endpoint removed)', async () => {
    // 实测：m.weibo.cn 搜索接口已失效，返回登录页 HTML（weibo.com cookie 不适用 + 微博移除 JSON 搜索 API）
    const { transport, getLastConfig } = createFakeAxios(async () => '<!doctype html><title>登录 - 微博</title>')
    const service = new SearchService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(service.searchUsers('前端开发', 1)).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
    // 非 JSON 响应不归为业务失败（此前误报 WeiboAPINotOkError + context 塞满 HTML）
    await expect(service.searchUsers('前端开发', 1)).rejects.not.toBeInstanceOf(WeiboAPINotOkError)
    // host 头从 URL 推导（m.weibo.cn 请求不应带 weibo.com Host，Commit 1 修复）
    expect(getLastConfig()?.headers?.host).toBe('m.weibo.cn')
  })

  it('searchTweets maps HTML response to ProtocolError', async () => {
    const { transport } = createFakeAxios(async () => '<html></html>')
    const service = new SearchService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(service.searchTweets('TypeScript', 1)).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
  })

  it('searchUsers still normalizes valid m.weibo.cn JSON when available', async () => {
    // 若上游恢复/提供 JSON：schema 应能解析，公开面返回归一化 camelCase 结果（保持契约）
    const response = {
      ok: 1,
      data: {
        cards: [
          {
            card_type: 11,
            card_group: [
              { user: { id: 1, screen_name: 'u1' } },
            ],
          },
        ],
        cardlistInfo: { page: 1, total: 10 },
      },
    } as any

    const { transport } = createFakeAxios(async () => response)
    const service = new SearchService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    // raw 形状仍通过 fetchRaw* 可访问
    const raw = await service.fetchRawSearchUsers('u', 1)
    expect(raw.data.cards[0].card_group).toHaveLength(1)

    const page = await service.searchUsers('u', 1)
    expect(page.users).toHaveLength(1)
    expect(page.users[0].id).toBe('1')
    expect(page.users[0].name).toBe('u1')
    expect(page.page).toBe(1)
    expect(page.total).toBe(10)
    expect(page.hasMore).toBe(true)
  })

  it('searchTweets still normalizes valid m.weibo.cn JSON when available', async () => {
    const response = {
      ok: 1,
      data: {
        cards: [
          {
            card_type: 9,
            mblog: {
              id: 1,
              idstr: '1',
              mblogid: 'AbCdEf',
              created_at: 'now',
              text: '',
              text_raw: 'hello',
              user: { id: 2, idstr: '2', screen_name: 'u' },
            },
          },
        ],
        cardlistInfo: { page: 1, total: 25 },
      },
    } as any

    const { transport } = createFakeAxios(async () => response)
    const service = new SearchService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.searchTweets('TypeScript', 1)
    expect(page.tweets).toHaveLength(1)
    expect(page.tweets[0].mblogId).toBe('AbCdEf')
    expect(page.tweets[0].text).toBe('hello')
    expect(page.page).toBe(1)
    expect(page.total).toBe(25)
    expect(page.hasMore).toBe(true)
  })
})
