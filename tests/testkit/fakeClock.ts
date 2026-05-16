import type { IRateLimitClock } from '~/services/internal/RateLimitService'

export class FakeClock implements IRateLimitClock {
  nowValue = 0
  sleepCalls: number[] = []

  now(): number { return this.nowValue }
  async sleep(ms: number): Promise<void> {
    this.sleepCalls.push(ms)
    this.nowValue += ms
  }
}
