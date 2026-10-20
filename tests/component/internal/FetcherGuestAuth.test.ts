import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import type { AuthContext, AuthProvider } from '~/services/internal/AuthProvider'
import type { IRequestResource } from '~/services/internal/FetcherService'
import type { IWeiboConfig } from '~/types/config'
import { TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { RateLimitError } from '~/models/errors/TransportError'
import { feedGroupsSpec } from '~/services/endpoints/groups'
import { myMblogSpec } from '~/services/endpoints/tweet'
import { userInfoSpec } from '~/services/endpoints/user'
import { FetcherService } from '~/services/internal/FetcherService'

interface FakeResponse {
  data: unknown
  status?: number
  headers?: Record<string, string>
}

/**
 * axios 替身：允许 handler 返回完整响应（status/headers），
 * 用于模拟 guest 模式的 302 登录跳转。
 */
function createResponseAxios(handler: (config: AxiosRequestConfig) => Promise<FakeResponse> | FakeResponse) {
  let calls = 0
  let lastConfig: AxiosRequestConfig | undefined
  const client = {
    interceptors: {
      request: { use() { return 0 } },
      response: { use() { return 0 }, eject() {}, clear() {} },
    },
    async request(config: AxiosRequestConfig) {
      calls += 1
      lastConfig = config
      const response = await handler(config)
      return {
        data: response.data,
        status: response.status ?? 200,
        statusText: 'OK',
        headers: response.headers ?? {},
        config,
      }
    },
  } as unknown as AxiosInstance

  return {
    client,
    getCalls: () => calls,
    getLastConfig: () => lastConfig,
  }
}

function axiosError(status: number, data: unknown = { ok: 0 }): Error {
  const error = new Error(`HTTP ${status}`) as Error & Record<string, unknown>
  error.isAxiosError = true
  error.response = { status, data, headers: {} }
  return error
}

function guestAuth(options: { refresh?: boolean } = {}) {
  let token = 'SUB=guest_1'
  let refreshCalls = 0
  const provider: AuthProvider = {
    mode: 'guest',
    async getHeaders() {
      return { Cookie: token }
    },
    async refresh() {
      refreshCalls += 1
      if (!options.refresh)
        return false
      token = 'SUB=guest_2'
      return true
    },
  }
  const none: AuthProvider = {
    mode: 'none',
    async getHeaders() {
      return {}
    },
  }
  const auth: AuthContext = {
    mode: 'guest',
    getProvider: endpointAuth => (endpointAuth === 'none' ? none : provider),
  }
  return {
    auth,
    getRefreshCalls: () => refreshCalls,
    getToken: () => token,
  }
}

class TestFetcherService extends FetcherService {
  public async callUser(uid: string): Promise<unknown> {
    return this.request(userInfoSpec, { uid })
  }

  public async callGroups(): Promise<unknown> {
    return this.request(feedGroupsSpec, {})
  }

  public async callCookieOnly(uid: string): Promise<unknown> {
    return this.request(myMblogSpec, { uid })
  }

  public async get<T>(resource: IRequestResource): Promise<T> {
    return this.fetch<T>(resource)
  }
}

function setup(
  config: Omit<IWeiboConfig, 'cookie'>,
  handler: (config: AxiosRequestConfig) => Promise<FakeResponse> | FakeResponse,
  auth = guestAuth(),
) {
  const telemetry = new TelemetryCollector()
  const axios = createResponseAxios(handler)
  const fetcher = new TestFetcherService(
    { cookie: '', telemetry, ...config },
    {
      client: axios.client,
      auth: auth.auth,
      rateLimitService: { acquire: async () => {}, pause: () => {} } as any,
      telemetry,
    },
  )
  return { fetcher, telemetry, axios, ...auth }
}

const USER_OK = {
  ok: 1,
  data: { user: { id: 1, idstr: '1', screen_name: 'target' } },
}

describe('fetcherService guest auth', () => {
  it('injects the guest cookie for guest endpoints and omits it for none endpoints', async () => {
    const { fetcher, axios, getToken } = setup({}, (config) => {
      if (String(config.url).includes('/feed/allGroups'))
        return { data: { ok: 1, groups: [] } }
      return { data: USER_OK }
    })

    await fetcher.callUser('1')
    expect(axios.getLastConfig()?.headers?.Cookie).toBe(getToken())

    await fetcher.callGroups()
    expect(axios.getLastConfig()?.headers?.Cookie).toBeUndefined()
  })

  it('refreshes once and retries on a login redirect', async () => {
    let calls = 0
    const { fetcher, getRefreshCalls, getToken, telemetry } = setup({}, () => {
      calls += 1
      if (calls === 1) {
        return {
          data: '',
          status: 302,
          headers: { location: 'https://passport.weibo.com/sso/signin?url=x' },
        }
      }
      return { data: USER_OK }
    }, guestAuth({ refresh: true }))

    await expect(fetcher.callUser('1')).resolves.toEqual(USER_OK)
    expect(calls).toBe(2)
    expect(getRefreshCalls()).toBe(1)
    expect(getToken()).toBe('SUB=guest_2')
    expect(telemetry.byName('request_success')[0]).toEqual(expect.objectContaining({
      auth_mode: 'guest',
      guest_refresh_count: 1,
    }))
  })

  it('refreshes once for an empty-object silent gate, then succeeds', async () => {
    let calls = 0
    const { fetcher, getRefreshCalls } = setup({}, () => {
      calls += 1
      return { data: calls === 1 ? {} : USER_OK }
    }, guestAuth({ refresh: true }))

    await expect(fetcher.callUser('1')).resolves.toEqual(USER_OK)
    expect(calls).toBe(2)
    expect(getRefreshCalls()).toBe(1)
  })

  it('refreshes once for ok=-100 and stops after a second failure', async () => {
    let calls = 0
    const { fetcher, getRefreshCalls } = setup({}, () => {
      calls += 1
      return { data: { ok: -100, message: '请先登录' } }
    }, guestAuth({ refresh: true }))

    await expect(fetcher.callUser('1')).rejects.toBeInstanceOf(WeiboSessionExpiredError)
    expect(calls).toBe(2)
    expect(getRefreshCalls()).toBe(1)
  })

  it('does not refresh on 432 and surfaces RateLimitError', async () => {
    const { fetcher, getRefreshCalls } = setup({ retry: { retries: 0 } }, () => {
      throw axiosError(432)
    })

    await expect(fetcher.callUser('1')).rejects.toBeInstanceOf(RateLimitError)
    expect(getRefreshCalls()).toBe(0)
  })

  it('rejects cookie-only endpoints before sending a request', async () => {
    const { fetcher, axios, getRefreshCalls } = setup({}, () => ({ data: { ok: 1 } }))

    await expect(fetcher.callCookieOnly('1')).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      context: expect.objectContaining({
        auth_mode: 'guest',
        requiredAuth: 'cookie',
      }),
    })
    expect(axios.getCalls()).toBe(0)
    expect(getRefreshCalls()).toBe(0)
  })

  it('emits auth_mode on request_start and request_error', async () => {
    const { fetcher, telemetry } = setup({ retry: { retries: 0 } }, () => {
      throw axiosError(500)
    })

    await expect(fetcher.callUser('1')).rejects.toBeTruthy()
    expect(telemetry.byName('request_start')[0]).toEqual(expect.objectContaining({ auth_mode: 'guest' }))
    expect(telemetry.byName('request_error')[0]).toEqual(expect.objectContaining({ auth_mode: 'guest' }))
  })
})
