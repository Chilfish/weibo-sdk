import type { UserInfoResponse } from '~/services/endpoints/user'
import { createFakeAxios, FakeClock, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { userInfoSpec } from '~/services/endpoints/user'
import { FetcherService } from '~/services/internal/FetcherService'
import { RateLimitService } from '~/services/internal/RateLimitService'

class TestFetcherService extends FetcherService {
  public async call(uid: string): Promise<UserInfoResponse> {
    return await this.request(userInfoSpec, { uid })
  }
}

describe('telemetry (wide events)', () => {
  it('emits request_start/request_success with shared trace_id', async () => {
    const telemetry = new TelemetryCollector()
    const { transport } = createFakeAxios(async () => ({ ok: 1, data: { user: { id: 1 } } }))
    const rateLimit = new RateLimitService(1, 1000, new FakeClock(), telemetry)

    const fetcher = new TestFetcherService(
      { cookie: 'SUB=abc', telemetry },
      { transport, rateLimitService: rateLimit, telemetry },
    )

    await fetcher.call('1')

    const starts = telemetry.events.filter(e => e.event_name === 'request_start')
    const successes = telemetry.events.filter(e => e.event_name === 'request_success')
    expect(starts).toHaveLength(1)
    expect(successes).toHaveLength(1)
    expect(starts[0].trace_id).toBe(successes[0].trace_id)
    expect(successes[0]).toEqual(expect.objectContaining({
      endpoint: 'ajax/profile/info',
      resource_type: 'USER_INFO',
      duration_ms: expect.any(Number),
    }))
  })

  it('emits rate_limit_wait when tokens are exhausted', async () => {
    const telemetry = new TelemetryCollector()
    const { transport } = createFakeAxios(async () => ({ ok: 1, data: { user: { id: 1 } } }))
    const clock = new FakeClock()
    const rateLimit = new RateLimitService(1, 1000, clock, telemetry)

    const fetcher = new TestFetcherService(
      { cookie: 'SUB=abc', telemetry },
      { transport, rateLimitService: rateLimit, telemetry },
    )

    await fetcher.call('1')
    await fetcher.call('1')

    const waits = telemetry.events.filter(e => e.event_name === 'rate_limit_wait')
    expect(waits).toHaveLength(1)
    expect(waits[0]).toEqual(expect.objectContaining({
      wait_ms: 1000,
      refill_rate_ms: 1000,
      max_tokens: 1,
    }))
    expect(clock.sleepCalls).toEqual([1000])
  })

  it('emits request_error for ok!=1 responses with structured error fields', async () => {
    const telemetry = new TelemetryCollector()
    const { transport } = createFakeAxios(async () => ({ ok: 0, msg: 'bad', data: {} }))
    const rateLimit = new RateLimitService(1, 1000, new FakeClock(), telemetry)

    const fetcher = new TestFetcherService(
      { cookie: 'SUB=abc', telemetry },
      { transport, rateLimitService: rateLimit, telemetry },
    )

    await expect(fetcher.call('1')).rejects.toBeInstanceOf(WeiboAPINotOkError)

    const errors = telemetry.events.filter(e => e.event_name === 'request_error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual(expect.objectContaining({
      phase: 'response',
      error_code: 'API_NOT_OK',
      error_level: 'business',
      error_retryable: false,
      endpoint: 'ajax/profile/info',
      resource_type: 'USER_INFO',
    }))
  })

  it('emits request_error for preflight failures', async () => {
    const telemetry = new TelemetryCollector()
    const { transport } = createFakeAxios(async () => ({ ok: 1, data: { user: { id: 1 } } }))
    const rateLimit = new RateLimitService(1, 1000, new FakeClock(), telemetry)

    const preflightError = new Error('preflight failed')
    const fetcher = new TestFetcherService(
      { cookie: 'SUB=abc', telemetry },
      {
        transport,
        rateLimitService: rateLimit,
        telemetry,
        preflight: async () => { throw preflightError },
      },
    )

    await expect(fetcher.call('1')).rejects.toThrow('preflight failed')

    const errors = telemetry.events.filter(e => e.event_name === 'request_error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0]).toEqual(expect.objectContaining({
      phase: 'preflight',
      error_name: 'Error',
    }))
  })

  it('emits request_error for parse (schema validation) failures', async () => {
    const telemetry = new TelemetryCollector()
    const { transport } = createFakeAxios(async () => ({ ok: 1 }))
    const rateLimit = new RateLimitService(1, 1000, new FakeClock(), telemetry)

    const fetcher = new TestFetcherService(
      { cookie: 'SUB=abc', telemetry },
      { transport, rateLimitService: rateLimit, telemetry },
    )

    await expect(fetcher.call('1')).rejects.toThrow()

    const errors = telemetry.events.filter(e => e.event_name === 'request_error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0]).toEqual(expect.objectContaining({
      phase: 'parse',
      error_code: 'API_BAD_RESPONSE',
    }))
  })
})
