/** 简单信号量：限制跨切片的补全请求并发，避免「切片数 × 窗口」叠加放大。 */
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: Array<() => void> = []

  const acquire = (): Promise<void> => new Promise<void>((resolve) => {
    if (active < limit) {
      active += 1
      resolve()
      return
    }
    waiting.push(() => {
      active += 1
      resolve()
    })
  })

  const release = (): void => {
    active -= 1
    waiting.shift()?.()
  }

  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire()
    try {
      return await task()
    }
    finally {
      release()
    }
  }
}

/** 固定 worker 数的任务池；单个任务抛错会结束该 worker，由调用方自行 catch。 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!shouldStop()) {
      const index = next
      next += 1
      if (index >= items.length)
        return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}
