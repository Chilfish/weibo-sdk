// src/services/internal/RateLimitService.ts
import type { WeiboSDKTelemetry } from '~/types/telemetry'

export interface IRateLimitClock {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export const defaultClock: IRateLimitClock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
}

/** 令牌桶等待原因（进 `rate_limit_wait` 事件，便于区分「补充令牌」与「432 全局暂停」）。 */
export type RateLimitWaitReason = 'token_refill' | 'rate_limited'

/** 暂停令牌桶的可选上下文（用于日志/调试，不参与调度）。 */
export interface IRateLimitPauseMeta {
  /** 触发暂停的链路 id（`request_retry` / `request_error` 可关联） */
  trace_id?: string
  /** 触发原因（如 `rate_limit` / `http_432`） */
  reason?: string
}

let rateLimitTraceSeq = 0
function createRateLimitTraceId(now: number): string {
  rateLimitTraceSeq += 1
  return `${now}-rl-${rateLimitTraceSeq}`
}

export class RateLimitService {
  private tokens: number
  private lastRefill: number
  /** 全局暂停截止时间（毫秒时间戳）；0 表示未暂停 */
  private pausedUntil = 0

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
   * 全局暂停取令牌（P1 可靠性：432 风控后避免并发请求同时撞墙）。
   *
   * 多次暂停取「最晚截止时间」（只延长、不缩短），`ms <= 0` / 非有限值忽略。
   * 已经开始的 `acquire()` 会在下一次循环检查到暂停并等待。
   */
  pause(ms: number, _meta?: IRateLimitPauseMeta): void {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0)
      return
    const until = this.clock.now() + ms
    this.pausedUntil = Math.max(this.pausedUntil, until)
  }

  /** 距离暂停结束的毫秒数（未暂停返回 0）。 */
  getPausedRemainingMs(): number {
    const remaining = this.pausedUntil - this.clock.now()
    return remaining > 0 ? remaining : 0
  }

  /** 当前是否处于全局暂停中。 */
  isPaused(): boolean {
    return this.getPausedRemainingMs() > 0
  }

  /**
   * 获取令牌，如果没有令牌则等待
   */
  async acquire(meta?: { trace_id?: string }): Promise<void> {
    // 这里用循环而不是递归，避免在长时间等待时构建深层 Promise 链
    while (true) {
      this.refill()

      const pausedFor = this.pausedUntil - this.clock.now()
      if (pausedFor > 0) {
        await this.emitWait(meta, pausedFor, 'rate_limited')
        await this.clock.sleep(pausedFor)
        continue
      }
      if (this.pausedUntil !== 0)
        this.pausedUntil = 0

      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }

      await this.emitWait(meta, this.refillRate, 'token_refill')
      await this.clock.sleep(this.refillRate)
    }
  }

  private async emitWait(meta: { trace_id?: string } | undefined, waitMs: number, reason: RateLimitWaitReason): Promise<void> {
    const now = this.clock.now()
    const traceId = meta?.trace_id ?? createRateLimitTraceId(now)
    try {
      await this.telemetry?.emit({
        event_name: 'rate_limit_wait',
        timestamp: now,
        trace_id: traceId,
        wait_ms: waitMs,
        refill_rate_ms: this.refillRate,
        max_tokens: this.maxTokens,
        tokens: this.tokens,
        reason,
      })
    }
    catch {
      // telemetry must not break SDK behavior
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
