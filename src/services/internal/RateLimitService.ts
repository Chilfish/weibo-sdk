// src/services/internal/RateLimitService.ts
export interface IRateLimitClock {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const defaultClock: IRateLimitClock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
}

export class RateLimitService {
  private tokens: number
  private lastRefill: number

  constructor(
    private maxTokens: number = 10,
    private refillRate: number = 1000, // ms per token
    private clock: IRateLimitClock = defaultClock,
  ) {
    this.tokens = maxTokens
    this.lastRefill = this.clock.now()
  }

  /**
   * 获取令牌，如果没有令牌则等待
   */
  async acquire(): Promise<void> {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }

    // 等待令牌生成
    const waitTime = this.refillRate
    await this.clock.sleep(waitTime)
    return this.acquire()
  }

  private refill(): void {
    const now = this.clock.now()
    const elapsed = now - this.lastRefill
    const newTokens = Math.floor(elapsed / this.refillRate)

    if (newTokens > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + newTokens)
      this.lastRefill = now
    }
  }
}
