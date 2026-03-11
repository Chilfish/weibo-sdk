import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import type { IRequestResource } from '~/services/internal/FetcherService'
import { describe, expect, it } from 'vitest'
import { ConnectionTimeoutError, NetworkRequestError } from '~/models/errors/TransportError'
import { FetcherService } from '~/services/internal/FetcherService'

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
  public acquireCalls = 0
  async acquire(): Promise<void> {
    this.acquireCalls += 1
  }
}

class TestFetcherService extends FetcherService {
  public async get<T>(resource: IRequestResource, args?: Record<string, unknown>): Promise<T> {
    return this.fetch<T>(resource, args)
  }
}

describe('fetcherService', () => {
  it('injects cookie and xsrf token headers', async () => {
    const { client, getLastConfig } = createFakeAxios(async () => ({ ok: 1 }))
    const rateLimit = new NoopRateLimitService()

    const fetcher = new TestFetcherService(
      {
        cookie: 'SUB=abc; XSRF-TOKEN=token123',
        xsrfToken: 'token_explicit',
      },
      {
        client,
        rateLimitService: rateLimit as any,
      },
    )

    const resource: IRequestResource = { method: 'GET', url: 'https://weibo.com/ajax/test' }
    await fetcher.get(resource, { uid: '1' })

    expect(rateLimit.acquireCalls).toBe(1)

    const cfg = getLastConfig()
    expect(cfg?.headers?.Cookie).toContain('SUB=abc')
    expect(cfg?.headers?.['X-XSRF-TOKEN']).toBe('token_explicit')
    expect(cfg?.params).toEqual({ uid: '1' })
  })

  it('maps timeout errors to ConnectionTimeoutError', async () => {
    const { client } = createFakeAxios(async () => {
      const err = new Error('timeout') as any
      err.isAxiosError = true
      err.code = 'ECONNABORTED'
      throw err
    })

    const fetcher = new TestFetcherService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(fetcher.get({ method: 'GET', url: 'https://weibo.com/ajax/test' }))
      .rejects
      .toBeInstanceOf(ConnectionTimeoutError)
  })

  it('maps request failures to NetworkRequestError with response metadata', async () => {
    const { client } = createFakeAxios(async () => {
      const err = new Error('bad response') as any
      err.isAxiosError = true
      err.code = 'ERR_BAD_RESPONSE'
      err.response = { status: 500, data: { ok: 0 } }
      throw err
    })

    const fetcher = new TestFetcherService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    await expect(fetcher.get({ method: 'GET', url: 'https://weibo.com/ajax/test' }))
      .rejects
      .toBeInstanceOf(NetworkRequestError)
  })
})
