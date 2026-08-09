import type { IRequestResource } from '~/services/internal/FetcherService'
import { createFakeAxios } from 'tests/testkit/fakeAxios'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionTimeoutError, NetworkRequestError } from '~/models/errors/TransportError'
import { FetcherService } from '~/services/internal/FetcherService'

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

  it('derives host header from request URL for cross-host endpoints', async () => {
    const { client, getLastConfig } = createFakeAxios(async () => ({ ok: 1 }))
    const fetcher = new TestFetcherService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    // weibo.com 端点 → Host: weibo.com
    await fetcher.get({ method: 'GET', url: 'https://weibo.com/ajax/statuses/show?id=x' })
    expect(getLastConfig()?.headers?.host).toBe('weibo.com')

    // m.weibo.cn 端点 → Host: m.weibo.cn（此前硬编码 weibo.com 导致 404）
    await fetcher.get({ method: 'GET', url: 'https://m.weibo.cn/api/container/getIndex?containerid=x' })
    expect(getLastConfig()?.headers?.host).toBe('m.weibo.cn')
  })

  it('runs preflight before request and emits hook on failure', async () => {
    const { client, getLastConfig } = createFakeAxios(async () => ({ ok: 1 }))
    const rateLimit = new NoopRateLimitService()

    const onError = vi.fn()
    const preflightError = new Error('preflight failed')

    const fetcher = new TestFetcherService(
      { cookie: 'SUB=abc', hooks: { onError } },
      {
        client,
        rateLimitService: rateLimit as any,
        preflight: async () => {
          throw preflightError
        },
      },
    )

    const resource: IRequestResource = { method: 'GET', url: 'https://weibo.com/ajax/test' }
    await expect(fetcher.get(resource, { uid: '1' })).rejects.toBe(preflightError)

    expect(rateLimit.acquireCalls).toBe(0)
    expect(getLastConfig()).toBeUndefined()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(preflightError, expect.objectContaining({
      phase: 'preflight',
      request: resource,
      args: { uid: '1' },
      trace_id: expect.any(String),
      timestamp: expect.any(Number),
    }))
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
