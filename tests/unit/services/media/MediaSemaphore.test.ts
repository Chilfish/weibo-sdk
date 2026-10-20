import { describe, expect, it } from 'vitest'
import { MediaSemaphore } from '~/services/internal/media/MediaSemaphore'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('mediaSemaphore', () => {
  it('limits concurrency and preserves FIFO order', async () => {
    const semaphore = new MediaSemaphore(2)
    let active = 0
    let peak = 0
    const order: number[] = []

    await Promise.all([1, 2, 3, 4].map(index => semaphore.run(async () => {
      active += 1
      peak = Math.max(peak, active)
      order.push(index)
      await delay(5)
      active -= 1
    })))

    expect(peak).toBe(2)
    expect(order).toEqual([1, 2, 3, 4])
    expect(semaphore.active).toBe(0)
    expect(semaphore.pending).toBe(0)
  })

  it('releases the slot when a task throws', async () => {
    const semaphore = new MediaSemaphore(1)
    await expect(semaphore.run(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')

    expect(semaphore.active).toBe(0)
    await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('clamps invalid limits', async () => {
    const low = new MediaSemaphore(0)
    const high = new MediaSemaphore(99)
    expect(low.active).toBe(0)
    expect(high.active).toBe(0)
    await Promise.all([low.run(async () => {}), high.run(async () => {})])
  })
})
