/** 媒体下载默认并发数。 */
export const DEFAULT_MEDIA_CONCURRENCY = 3

/** 媒体下载并发硬上限。 */
export const MAX_MEDIA_CONCURRENCY = 8

/**
 * FIFO 计数信号量：取槽 → 执行 → 归还（异常也归还）。
 *
 * 只用于媒体 CDN 下载，与 API 令牌桶（`RateLimitService`）互相独立。
 */
export class MediaSemaphore {
  private activeCount = 0
  private readonly queue: Array<() => void> = []
  private readonly limit: number

  constructor(limit: number) {
    this.limit = Number.isFinite(limit)
      ? Math.min(MAX_MEDIA_CONCURRENCY, Math.max(1, Math.floor(limit)))
      : DEFAULT_MEDIA_CONCURRENCY
  }

  get active(): number {
    return this.activeCount
  }

  get pending(): number {
    return this.queue.length
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    }
    finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.activeCount < this.limit) {
      this.activeCount += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
      return
    }
    this.activeCount = Math.max(0, this.activeCount - 1)
  }
}
