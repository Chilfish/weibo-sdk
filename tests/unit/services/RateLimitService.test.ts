import { FakeClock, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { RateLimitService } from '~/services/internal/RateLimitService'

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
