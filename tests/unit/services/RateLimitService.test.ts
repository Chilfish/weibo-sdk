import { FakeClock } from 'tests/testkit'
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
})
