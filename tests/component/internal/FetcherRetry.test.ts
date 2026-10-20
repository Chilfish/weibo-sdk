import type { FakeAxiosHandler } from 'tests/testkit'
import type { IRequestResource } from '~/services/internal/FetcherService'
import type { IWeiboConfig } from '~/types/config'
import { createFakeAxios, FakeClock, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { NetworkRequestError, RateLimitError } from '~/models/errors/TransportError'
import { userInfoSpec } from '~/services/endpoints/user'
import { FetcherService } from '~/services/internal/FetcherService'
import { RateLimitService } from '~/services/internal/RateLimitService'

class TestFetcherService extends FetcherService {
  public async get<T>(resource: IRequestResource): Promise<T> {
    return this.fetch<T>(resource)
  }

  /** 走完整 `request()`（含 okPolicy / Zod 校验），用于断言业务错误不重试。 */
  public async callUser(uid: string): Promise<unknown> {
    return this.request(userInfoSpec, { uid })
  }
}

const RESOURCE: IRequestResource = { method: 'GET', url: 'https://weibo.com/ajax/test' }

interface FakeAxiosErrorOptions {
  status?: number
  code?: string
  retryAfter?: string
  data?: unknown
  message?: string
}

/** 构造 axios 形态的错误（`isAxiosError` + 可选 `response.status/headers`）。 */
function fakeAxiosError(options: FakeAxiosErrorOptions = {}): Error {
  const error = new Error(options.message ?? `HTTP ${options.status ?? 'unknown'}`) as Error & Record<string, unknown>
  error.isAxiosError = true
  if (options.code)
    error.code = options.code
  if (options.status !== undefined || options.data !== undefined || options.retryAfter !== undefined) {
    error.response = {
      status: options.status,
      data: options.data ?? { ok: 0, message: 'rate limited' },
      headers: options.retryAfter === undefined ? {} : { 'Retry-After': options.retryAfter },
    }
  }
  return error
}

/**
 * 组装可注入时钟/限流/telemetry 的 FetcherService。
 *
 * 共享同一个 `FakeClock`，保证退避睡眠与令牌桶暂停在测试里时间线一致（零真实等待）。
 */
function setup(config: Omit<IWeiboConfig, 'cookie'>, handler: FakeAxiosHandler, tokens = 10) {
  const telemetry = new TelemetryCollector()
  const clock = new FakeClock()
  const rateLimit = new RateLimitService(tokens, 1000, clock, telemetry)
  const { client } = createFakeAxios(handler)
  const fetcher = new TestFetcherService(
    { cookie: 'SUB=abc', telemetry, ...config },
    { client, rateLimitService: rateLimit, telemetry, clock },
  )

  return { fetcher, telemetry, clock, rateLimit }
}

describe('fetcherService retry (432 / 429 / 5xx / timeout)', () => {
  it('backs off on HTTP 432 then succeeds', async () => {
    let calls = 0
    const { fetcher, telemetry, clock } = setup(
      { retry: { retries: 2, baseDelayMs: 100, maxDelayMs: 1000 } },
      async () => {
        calls += 1
        if (calls === 1)
          throw fakeAxiosError({ status: 432 })
        return { ok: 1 }
      },
    )

    await expect(fetcher.get(RESOURCE)).resolves.toEqual({ ok: 1 })

    expect(calls).toBe(2)
    expect(clock.sleepCalls).toHaveLength(1)
    // jitter 保留 50% 下界：延迟 ∈ [baseDelayMs/2, baseDelayMs]
    expect(clock.sleepCalls[0]).toBeGreaterThanOrEqual(50)
    expect(clock.sleepCalls[0]).toBeLessThanOrEqual(100)

    const retries = telemetry.byName('request_retry')
    expect(retries).toHaveLength(1)
    expect(retries[0]).toEqual(expect.objectContaining({
      reason: 'rate_limit',
      attempt: 1,
      max_attempts: 3,
      status: 432,
      error_code: 'RATE_LIMITED',
      error_retryable: true,
      error_level: 'transport',
    }))
    // 重试成功后是终态成功，不再发 request_error
    expect(telemetry.byName('request_error')).toHaveLength(0)
  })

  it('stops at the retry limit and throws RateLimitError with attempt context', async () => {
    let calls = 0
    const { fetcher, telemetry, clock } = setup(
      { retry: { retries: 2, baseDelayMs: 100, maxDelayMs: 1000 } },
      async () => {
        calls += 1
        throw fakeAxiosError({ status: 432 })
      },
    )

    const error = await fetcher.get(RESOURCE).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(RateLimitError)
    expect(calls).toBe(3)
    expect(clock.sleepCalls).toHaveLength(2)
    expect(clock.sleepCalls[0]).toBeGreaterThanOrEqual(50)
    expect(clock.sleepCalls[0]).toBeLessThanOrEqual(100)
    expect(clock.sleepCalls[1]).toBeGreaterThanOrEqual(100)
    expect(clock.sleepCalls[1]).toBeLessThanOrEqual(200)

    const rateLimitError = error as RateLimitError
    expect(rateLimitError.code).toBe('RATE_LIMITED')
    expect(rateLimitError.retryable).toBe(true)
    expect(rateLimitError.context).toEqual(expect.objectContaining({ status: 432, attempt: 3 }))

    expect(telemetry.byName('request_retry')).toHaveLength(2)
    const errors = telemetry.byName('request_error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual(expect.objectContaining({
      phase: 'request',
      attempt: 3,
      error_code: 'RATE_LIMITED',
    }))
  })

  it('honors Retry-After in seconds (no jitter)', async () => {
    let calls = 0
    const { fetcher, clock } = setup(
      { retry: { retries: 1, baseDelayMs: 100, maxDelayMs: 8000 } },
      async () => {
        calls += 1
        if (calls === 1)
          throw fakeAxiosError({ status: 429, retryAfter: '2' })
        return { ok: 1 }
      },
    )

    await expect(fetcher.get(RESOURCE)).resolves.toEqual({ ok: 1 })
    expect(clock.sleepCalls).toEqual([2000])
  })

  it('honors Retry-After as an HTTP date', async () => {
    let calls = 0
    const { fetcher, clock } = setup(
      { retry: { retries: 1, baseDelayMs: 100, maxDelayMs: 8000 } },
      async () => {
        calls += 1
        if (calls === 1)
          throw fakeAxiosError({ status: 432, retryAfter: 'Thu, 01 Jan 2026 00:00:03 GMT' })
        return { ok: 1 }
      },
    )
    clock.nowValue = Date.parse('2026-01-01T00:00:00Z')

    await expect(fetcher.get(RESOURCE)).resolves.toEqual({ ok: 1 })
    expect(clock.sleepCalls).toEqual([3000])
  })

  it('retries 5xx responses and timeouts', async () => {
    let serverCalls = 0
    const server = setup({ retry: { retries: 1, baseDelayMs: 10, maxDelayMs: 10 } }, async () => {
      serverCalls += 1
      if (serverCalls === 1)
        throw fakeAxiosError({ status: 503 })
      return { ok: 1 }
    })
    await expect(server.fetcher.get(RESOURCE)).resolves.toEqual({ ok: 1 })
    expect(serverCalls).toBe(2)
    expect(server.telemetry.byName('request_retry')[0]).toEqual(expect.objectContaining({
      reason: 'server_error',
      status: 503,
      error_code: 'NET_REQUEST_FAILED',
    }))

    let timeoutCalls = 0
    const timeout = setup({ retry: { retries: 1, baseDelayMs: 10, maxDelayMs: 10 } }, async () => {
      timeoutCalls += 1
      if (timeoutCalls === 1)
        throw fakeAxiosError({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' })
      return { ok: 1 }
    })
    await expect(timeout.fetcher.get(RESOURCE)).resolves.toEqual({ ok: 1 })
    expect(timeoutCalls).toBe(2)
    expect(timeout.telemetry.byName('request_retry')[0]).toEqual(expect.objectContaining({
      reason: 'timeout',
      error_code: 'NET_TIMEOUT',
    }))
  })

  it('does not retry non-retryable failures', async () => {
    let notFoundCalls = 0
    const notFound = setup({}, async () => {
      notFoundCalls += 1
      throw fakeAxiosError({ status: 404 })
    })
    await expect(notFound.fetcher.get(RESOURCE)).rejects.toBeInstanceOf(NetworkRequestError)
    expect(notFoundCalls).toBe(1)
    expect(notFound.clock.sleepCalls).toHaveLength(0)
    expect(notFound.telemetry.byName('request_retry')).toHaveLength(0)

    let okCalls = 0
    const business = setup({ retry: { retries: 2, baseDelayMs: 10, maxDelayMs: 10 } }, async () => {
      okCalls += 1
      return { ok: 0, message: 'not found' }
    })
    await expect(business.fetcher.callUser('1')).rejects.toBeInstanceOf(WeiboAPINotOkError)
    expect(okCalls).toBe(1)
    expect(business.clock.sleepCalls).toHaveLength(0)
  })

  it('supports retries: 0 and an empty retryOn list', async () => {
    let calls = 0
    const zero = setup({ retry: { retries: 0 } }, async () => {
      calls += 1
      throw fakeAxiosError({ status: 432 })
    })
    await expect(zero.fetcher.get(RESOURCE)).rejects.toBeInstanceOf(RateLimitError)
    expect(calls).toBe(1)
    expect(zero.clock.sleepCalls).toHaveLength(0)

    let filteredCalls = 0
    const filtered = setup({ retry: { retries: 3, retryOn: [] } }, async () => {
      filteredCalls += 1
      throw fakeAxiosError({ status: 432 })
    })
    await expect(filtered.fetcher.get(RESOURCE)).rejects.toBeInstanceOf(RateLimitError)
    expect(filteredCalls).toBe(1)
    expect(filtered.clock.sleepCalls).toHaveLength(0)
  })

  it('pauses the shared token bucket after 432 so other requests wait', async () => {
    let calls = 0
    const { fetcher, telemetry, clock, rateLimit } = setup(
      { retry: { retries: 0, baseDelayMs: 300, maxDelayMs: 300 } },
      async () => {
        calls += 1
        if (calls === 1)
          throw fakeAxiosError({ status: 432 })
        return { ok: 1 }
      },
    )

    await expect(fetcher.get(RESOURCE)).rejects.toBeInstanceOf(RateLimitError)

    // 即使不重试，也要暂停全局令牌桶
    expect(rateLimit.isPaused()).toBe(true)
    const pauseMs = rateLimit.getPausedRemainingMs()
    expect(pauseMs).toBeGreaterThan(0)
    expect(pauseMs).toBeLessThanOrEqual(300)

    // 后续请求在暂停期内先等待，暂停结束后才发出
    await expect(fetcher.get(RESOURCE)).resolves.toEqual({ ok: 1 })

    expect(calls).toBe(2)
    expect(clock.sleepCalls).toEqual([pauseMs])
    expect(rateLimit.isPaused()).toBe(false)

    const waits = telemetry.byName('rate_limit_wait')
    expect(waits).toHaveLength(1)
    expect(waits[0]).toEqual(expect.objectContaining({ reason: 'rate_limited', wait_ms: pauseMs }))
  })
})
