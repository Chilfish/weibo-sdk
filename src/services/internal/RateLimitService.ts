// src/services/internal/RateLimitService.ts
import type { WeiboSDKTelemetry } from '~/types/telemetry'

export interface IRateLimitClock {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const defaultClock: IRateLimitClock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
}

let rateLimitTraceSeq = 0
function createRateLimitTraceId(now: number): string {
  rateLimitTraceSeq += 1
  return `${now}-rl-${rateLimitTraceSeq}`
}

export class RateLimitService {
  private tokens: number
  private lastRefill: number

  constructor(
    private maxTokens: number = 10,
    private refillRate: number = 1000, // ms per token
    private clock: IRateLimitClock = defaultClock,
    private telemetry?: WeiboSDKTelemetry,
  ) {
    this.tokens = maxTokens
    this.lastRefill = this.clock.now()
  }

  /**
   * 获取令牌，如果没有令牌则等待
   */
  async acquire(meta?: { trace_id?: string }): Promise<void> {
    // 这里用循环而不是递归，避免在长时间等待时构建深层 Promise 链
    while (true) {
      this.refill()

      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }

      const now = this.clock.now()
      const traceId = meta?.trace_id ?? createRateLimitTraceId(now)
      try {
        await this.telemetry?.emit({
          event_name: 'rate_limit_wait',
          timestamp: now,
          trace_id: traceId,
          wait_ms: this.refillRate,
          refill_rate_ms: this.refillRate,
          max_tokens: this.maxTokens,
          tokens: this.tokens,
        })
      }
      catch {
        // telemetry must not break SDK behavior
      }

      await this.clock.sleep(this.refillRate)
    }
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
