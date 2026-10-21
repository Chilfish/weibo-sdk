import type { IRequestResource } from '~/services/internal/FetcherService'
import type { IWeiboConfig } from '~/types/config'
import { createFakeAxios } from 'tests/testkit'
import { describe, expect, it, vi } from 'vitest'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { userInfoSpec } from '~/services/endpoints/user'
import { FetcherService } from '~/services/internal/FetcherService'

class TestFetcherService extends FetcherService {
  public async get<T>(resource: IRequestResource): Promise<T> {
    return this.fetch<T>(resource)
  }

  public async callUser(uid: string): Promise<unknown> {
    return this.request(userInfoSpec, { uid })
  }
}

const RESOURCE: IRequestResource = { method: 'GET', url: 'https://weibo.com/ajax/test' }

function setup(
  config: Omit<IWeiboConfig, 'cookie'>,
  handler: Parameters<typeof createFakeAxios>[0],
) {
  const { transport, getLastConfig } = createFakeAxios(handler)
  const fetcher = new TestFetcherService(
    { cookie: 'SUB=abc', ...config },
    { transport, rateLimitService: { acquire: async () => {} } as any },
  )
  return { fetcher, getLastConfig }
}

function fakeAxiosError(status: number): Error {
  const error = new Error(`HTTP ${status}`) as Error & Record<string, unknown>
  error.isAxiosError = true
  error.response = { status, data: { ok: 0 }, headers: {} }
  return error
}

describe('fetcherService proxy', () => {
  it('passes a static proxy URL as axios proxy config', async () => {
    const { fetcher, getLastConfig } = setup({ proxy: 'http://127.0.0.1:7890' }, async () => ({ ok: 1 }))

    await fetcher.get(RESOURCE)

    expect(getLastConfig()?.proxy).toMatchObject({
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    })
  })

  it('resolves a dynamic provider on every attempt', async () => {
    const getProxy = vi.fn(async (context: { attempt: number }) => `http://proxy${context.attempt}.local:8080`)
    let calls = 0
    const { fetcher } = setup(
      { proxy: { getProxy }, retry: { retries: 1, baseDelayMs: 0 } },
      async () => {
        calls += 1
        if (calls === 1)
          throw fakeAxiosError(500)
        return { ok: 1 }
      },
    )

    await fetcher.get(RESOURCE)

    expect(getProxy).toHaveBeenCalledTimes(2)
    expect(getProxy.mock.calls.map(call => call[0].attempt)).toEqual([1, 2])
  })

  it('disables environment proxies when no proxy is configured', async () => {
    const { fetcher, getLastConfig } = setup({}, async () => ({ ok: 1 }))

    await fetcher.get(RESOURCE)

    expect(getLastConfig()?.proxy).toBe(false)
  })

  it('rejects invalid proxy URLs with InvalidConfigError', async () => {
    const { fetcher } = setup({ proxy: 'not a url' }, async () => ({ ok: 1 }))

    await expect(fetcher.get(RESOURCE)).rejects.toBeInstanceOf(InvalidConfigError)
  })
})

describe('fetcherService auth diagnostics', () => {
  it('maps ok=-100 to WeiboSessionExpiredError with next steps', async () => {
    const { fetcher } = setup({}, async () => ({ ok: -100, message: '请先登录' }))

    await expect(fetcher.callUser('111')).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      context: {
        hint: expect.stringContaining('Cookie'),
        next: expect.stringContaining('weibo.com'),
      },
    })
    await expect(fetcher.callUser('111')).rejects.toBeInstanceOf(WeiboSessionExpiredError)
  })

  it('maps a login HTML page to a protocol error with next steps', async () => {
    const { fetcher } = setup({}, async () => '<html><body>请登录 passport.weibo.com</body></html>')

    await expect(fetcher.callUser('111')).rejects.toMatchObject({
      code: 'API_BAD_RESPONSE',
      context: {
        hint: expect.stringContaining('HTML'),
        next: expect.stringContaining('weibo.com'),
      },
    })
    await expect(fetcher.callUser('111')).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
  })
})
