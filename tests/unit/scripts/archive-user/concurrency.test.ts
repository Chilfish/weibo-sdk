import { describe, expect, it } from 'vitest'
import { createLimiter, runPool } from '../../../../scripts/archive-user/concurrency'

describe('createLimiter', () => {
  it('neverExceedsLimit', async () => {
    const limit = createLimiter(2)
    let active = 0
    let peak = 0

    await Promise.all(Array.from({ length: 10 }, () => limit(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active -= 1
    })))

    expect(peak).toBe(2)
  })

  it('releasesSlotWhenTaskThrows', async () => {
    const limit = createLimiter(1)
    await expect(limit(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')

    await expect(limit(async () => 'ok')).resolves.toBe('ok')
  })

  it('runsTasksInFifoOrder', async () => {
    const limit = createLimiter(1)
    const order: number[] = []

    await Promise.all([0, 1, 2].map(index => limit(async () => {
      order.push(index)
    })))

    expect(order).toEqual([0, 1, 2])
  })
})

describe('runPool', () => {
  it('processesEveryItemWithBoundedWorkers', async () => {
    const items = Array.from({ length: 10 }, (_, index) => index)
    const seen: number[] = []
    let active = 0
    let peak = 0

    await runPool(items, 3, async (item) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      seen.push(item)
      active -= 1
    })

    expect(seen.sort((a, b) => a - b)).toEqual(items)
    expect(peak).toBe(3)
  })

  it('stopsDispatchingWhenShouldStopBecomesTrue', async () => {
    let stopped = false
    const seen: number[] = []

    await runPool([0, 1, 2, 3, 4], 1, async (item) => {
      seen.push(item)
      stopped = item === 1
    }, () => stopped)

    expect(seen).toEqual([0, 1])
  })

  it('workerErrorRejectsPool', async () => {
    await expect(runPool([0, 1], 1, async (item) => {
      if (item === 1)
        throw new Error('boom')
    })).rejects.toThrow('boom')
  })
})
