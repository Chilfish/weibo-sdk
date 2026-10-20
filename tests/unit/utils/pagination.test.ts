import { describe, expect, it, vi } from 'vitest'
import { paginate } from '~/utils/pagination'

describe('paginate', () => {
  it('yields all items across pages and stops on empty page', async () => {
    const fetchPage = vi.fn(async (cursor?: number) => {
      if (cursor === 1)
        return { items: ['A', 'B'], next: 2, total: 4 }
      if (cursor === 2)
        return { items: ['C', 'D'], next: 3, total: 4 }
      return { items: [], next: undefined, total: 4 }
    })

    const out: string[] = []
    for await (const item of paginate(fetchPage, { initialCursor: 1, getKey: item => item }))
      out.push(item)

    expect(out).toEqual(['A', 'B', 'C', 'D'])
    // total=4 时处理完即停止，不再请求空页
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls.map(call => call[0])).toEqual([1, 2])
  })

  it('dedupes items across pages and stops when a whole page is repeated', async () => {
    const fetchPage = vi.fn(async () => ({ items: ['A', 'B'], next: 2 }))

    const out: string[] = []
    for await (const item of paginate(fetchPage, { getKey: item => item }))
      out.push(item)

    expect(out).toEqual(['A', 'B'])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('stops when cursor does not advance', async () => {
    const fetchPage = vi.fn(async () => ({ items: ['A'], next: 1 }))

    const out: string[] = []
    for await (const item of paginate(fetchPage, {
      initialCursor: 1,
      getKey: item => item,
      maxPages: 5,
    })) {
      out.push(item)
    }

    expect(out).toEqual(['A'])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('honors maxPages and hasMore=false', async () => {
    const fetchPage = vi.fn(async (cursor?: number) => ({
      items: [`I${cursor}`],
      next: (cursor ?? 0) + 1,
    }))

    const out: string[] = []
    for await (const item of paginate(fetchPage, {
      initialCursor: 1,
      getKey: item => item,
      maxPages: 2,
    })) {
      out.push(item)
    }

    expect(out).toEqual(['I1', 'I2'])
    expect(fetchPage).toHaveBeenCalledTimes(2)

    const noMore = vi.fn(async () => ({ items: ['X'], next: 2, hasMore: false }))
    const second: string[] = []
    for await (const item of paginate(noMore, { getKey: item => item }))
      second.push(item)
    expect(second).toEqual(['X'])
    expect(noMore).toHaveBeenCalledTimes(1)
  })

  it('reports progress per page and isolates callback errors', async () => {
    const fetchPage = vi.fn(async (cursor?: number) => ({
      items: [`I${cursor}`],
      next: (cursor ?? 0) + 1,
      total: 2,
    }))
    const progress = vi.fn(() => {
      throw new Error('progress failed')
    })

    const out: string[] = []
    for await (const item of paginate(fetchPage, {
      initialCursor: 1,
      getKey: item => item,
      maxPages: 2,
      onProgress: progress,
    })) {
      out.push(item)
    }

    expect(out).toEqual(['I1', 'I2'])
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      processed: 1,
      pageSize: 1,
      total: 2,
    }))
  })

  it('honors maxItems across pages without fetching extra pages', async () => {
    const fetchPage = vi.fn(async (cursor?: number) => ({
      items: [`A${cursor}`, `B${cursor}`],
      next: (cursor ?? 0) + 1,
    }))

    const out: string[] = []
    for await (const item of paginate(fetchPage, {
      initialCursor: 1,
      getKey: item => item,
      maxItems: 3,
    })) {
      out.push(item)
    }

    expect(out).toEqual(['A1', 'B1', 'A2'])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('skips items newer than until and stops at since', async () => {
    const at = (iso: string) => ({ time: Date.parse(iso) / 1000 })
    const fetchPage = vi.fn(async (cursor?: number) => {
      if (cursor === 1)
        return { items: [at('2026-10-03T00:00:00Z'), at('2026-10-02T00:00:00Z')], next: 2 }
      return { items: [at('2026-10-01T00:00:00Z'), at('2026-09-30T00:00:00Z')], next: 3 }
    })

    const out: number[] = []
    for await (const item of paginate(fetchPage, {
      initialCursor: 1,
      maxPages: 5,
      getKey: item => String(item.time),
      getTime: item => item.time,
      until: Date.parse('2026-10-02T00:00:00Z') / 1000,
      since: Date.parse('2026-10-01T00:00:00Z') / 1000,
    })) {
      out.push(item.time)
    }

    expect(out).toEqual([
      Date.parse('2026-10-02T00:00:00Z') / 1000,
      Date.parse('2026-10-01T00:00:00Z') / 1000,
    ])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('throws CONFIG_INVALID when date bounds are used without getTime', async () => {
    const fetchPage = vi.fn(async () => ({ items: ['A'], next: 2 }))
    await expect(async () => {
      for await (const _ of paginate(fetchPage, { since: '2026-10-01' })) {
        // consume
      }
    }).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })
})
