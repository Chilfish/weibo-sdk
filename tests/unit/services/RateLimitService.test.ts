import { FakeClock, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { RateLimitService } from '~/services/internal/RateLimitService'

describe('rateLimitService invariants', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects invalid burst %s instead of hanging later', (burst) => {
    expect(() => new RateLimitService(burst, 1000, new FakeClock())).toThrowError(InvalidConfigError)
  })

  it.each([-1, -100, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid delay %s instead of hanging later', (delay) => {
    expect(() => new RateLimitService(1, delay, new FakeClock())).toThrowError(InvalidConfigError)
  })

  it('treats delay 0 as explicit no-throttle', async () => {
    const clock = new FakeClock()
    const rl = new RateLimitService(1, 0, clock)

    // 远超 burst 的次数也不应等待或挂起
    for (let i = 0; i < 5; i++)
      await rl.acquire()

    expect(clock.sleepCalls).toHaveLength(0)
  })
})

describe('rateLimitService', () => {
  it('acquires immediately when tokens are available', async () => {
    const clock = new FakeClock()
    const rl = new RateLimitService(2, 1000, clock)

    await rl.acquire()
    await rl.acquire()

    expect(clock.sleepCalls).toHaveLength(0)
  })

  it('waits when tokens are exhausted then succeeds', async () => {
    const clock = new FakeClock()
    const rl = new RateLimitService(1, 1000, clock)

    await rl.acquire()
    await rl.acquire()

    expect(clock.sleepCalls).toEqual([1000])
    expect(clock.nowValue).toBe(1000)
  })

  it('refills based on elapsed time', async () => {
    const clock = new FakeClock()
    const rl = new RateLimitService(1, 1000, clock)

    await rl.acquire() // consume token
    clock.nowValue += 5000 // advance time so refill happens
    await rl.acquire()

    expect(clock.sleepCalls).toHaveLength(0)
  })

  it('refill waits are tagged with reason=token_refill', async () => {
    const clock = new FakeClock()
    const telemetry = new TelemetryCollector()
    const rl = new RateLimitService(1, 1000, clock, telemetry)

    await rl.acquire()
    await rl.acquire()

    expect(telemetry.byName('rate_limit_wait')).toHaveLength(1)
    expect(telemetry.byName('rate_limit_wait')[0]).toEqual(expect.objectContaining({
      reason: 'token_refill',
      wait_ms: 1000,
    }))
  })
})

describe('rateLimitService global pause (432 风控协作)', () => {
  it('is not paused by default', () => {
    const rl = new RateLimitService(1, 1000, new FakeClock())

    expect(rl.isPaused()).toBe(false)
    expect(rl.getPausedRemainingMs()).toBe(0)
  })

  it('waits for the pause before handing out a token', async () => {
    const clock = new FakeClock()
    const telemetry = new TelemetryCollector()
    const rl = new RateLimitService(2, 1000, clock, telemetry)

    rl.pause(500)

    expect(rl.isPaused()).toBe(true)
    expect(rl.getPausedRemainingMs()).toBe(500)

    await rl.acquire()

    expect(clock.sleepCalls).toEqual([500])
    expect(rl.isPaused()).toBe(false)
    expect(telemetry.byName('rate_limit_wait')).toHaveLength(1)
    expect(telemetry.byName('rate_limit_wait')[0]).toEqual(expect.objectContaining({
      reason: 'rate_limited',
      wait_ms: 500,
    }))
  })

  it('keeps the furthest deadline (pauses only extend)', () => {
    const clock = new FakeClock()
    const rl = new RateLimitService(1, 1000, clock)

    rl.pause(300)
    rl.pause(100)

    expect(rl.getPausedRemainingMs()).toBe(300)

    clock.nowValue = 100
    rl.pause(500)

    expect(rl.getPausedRemainingMs()).toBe(500)
  })

  it('ignores non-positive or non-finite pauses', () => {
    const rl = new RateLimitService(1, 1000, new FakeClock())

    rl.pause(0)
    rl.pause(-100)
    rl.pause(Number.NaN)
    rl.pause(Number.POSITIVE_INFINITY)

    expect(rl.isPaused()).toBe(false)
  })

  it('resumes immediately once the pause has elapsed', async () => {
    const clock = new FakeClock()
    const rl = new RateLimitService(1, 1000, clock)

    rl.pause(200)
    clock.nowValue += 200

    await rl.acquire()

    expect(clock.sleepCalls).toHaveLength(0)
  })
})
