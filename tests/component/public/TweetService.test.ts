import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import type { IMyMBlogResponse } from '~/types/raw/tweet/mymblog'
import { describe, expect, it, vi } from 'vitest'
import { TweetService } from '~/services/public/TweetService'

function createFakeAxios(
  handler: (config: AxiosRequestConfig) => Promise<unknown>,
): { client: AxiosInstance, getLastConfig: () => AxiosRequestConfig | undefined } {
  let interceptor: ((config: any) => any) | undefined
  let lastConfig: AxiosRequestConfig | undefined

  const client: AxiosInstance = {
    interceptors: {
      request: {
        use(fn: any) {
          interceptor = fn
          return 0
        },
      },
      response: {
        use() {
          return 0
        },
        eject() {},
        clear() {},
      } as any,
    } as any,
    async request(config: any) {
      const finalConfig = interceptor ? interceptor(config) : config
      lastConfig = finalConfig
      const data = await handler(finalConfig)
      return { data } as any
    },
  } as any

  return { client, getLastConfig: () => lastConfig }
}

class NoopRateLimitService {
  async acquire(): Promise<void> {}
}

describe('tweetService', () => {
  it('calls mymblog endpoint with correct params and triggers onFetched', async () => {
    const response = { since_id: 0, list: [], total: 0 } as any as IMyMBlogResponse

    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/statuses/mymblog')
      return response
    })

    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    service.onFetched = vi.fn()

    const data = await service.myMblog('111', 123)
    expect(data.since_id).toBe(0)

    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ uid: '111', since_id: 123 })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/111')
    expect(service.onFetched).toHaveBeenCalledWith('TWEET_MYMBLOG', response)
  })

  it('listByUserId returns normalized Tweet list', async () => {
    const response = {
      since_id: 456,
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
      total: 1,
    } as any as IMyMBlogResponse

    const { client } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.listByUserId('111')
    expect(page.sinceId).toBe(456)
    expect(page.tweets).toHaveLength(1)
    expect(page.tweets[0].id).toBe('1')
  })
})
