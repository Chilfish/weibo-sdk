import { describe, expect, it } from 'vitest'
import { createStreamRange, normalizeMaxItems } from '~/utils/streamRange'

function seconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000)
}

interface Item {
  id: string
  createdAt: string
}

const oct3: Item = { id: 'oct3', createdAt: '2026-10-03T00:00:00Z' }
const oct2: Item = { id: 'oct2', createdAt: '2026-10-02T00:00:00Z' }
const oct1: Item = { id: 'oct1', createdAt: '2026-10-01T00:00:00Z' }

function take<T>(range: ReturnType<typeof createStreamRange<T>>, items: T[]): T[] {
  const out: T[] = []
  for (const item of items) {
    const decision = range.decide(item)
    if (decision === 'stop')
      break
    if (decision === 'skip')
      continue
    out.push(item)
  }
  return out
}

describe('createStreamRange', () => {
  it('limits by maxItems and reports full/stopped', () => {
    const range = createStreamRange<Item>({ maxItems: 2 }, item => item.createdAt)
    expect(take(range, [oct3, oct2, oct1]).map(item => item.id)).toEqual(['oct3', 'oct2'])
    expect(range.count).toBe(2)
    expect(range.full).toBe(true)
    expect(range.stopped).toBe(true)
    expect(range.decide(oct1)).toBe('stop')
  })

  it('treats maxItems<=0 as empty stream', () => {
    const range = createStreamRange<Item>({ maxItems: 0 })
    expect(range.decide(oct3)).toBe('stop')
    expect(range.full).toBe(true)
  })

  it('stops at the since boundary (older items are not taken)', () => {
    const range = createStreamRange<Item>({ since: seconds('2026-10-02T00:00:00Z') }, item => item.createdAt)
    expect(take(range, [oct3, oct2, oct1]).map(item => item.id)).toEqual(['oct3', 'oct2'])
    expect(range.stopped).toBe(true)
    expect(range.full).toBe(false)
  })

  it('skips items newer than until and keeps the rest', () => {
    const range = createStreamRange<Item>({ until: seconds('2026-10-02T00:00:00Z') }, item => item.createdAt)
    expect(take(range, [oct3, oct2, oct1]).map(item => item.id)).toEqual(['oct2', 'oct1'])
    expect(range.count).toBe(2)
    expect(range.stopped).toBe(false)
  })

  it('combines since/until into a window', () => {
    const range = createStreamRange<Item>({
      since: seconds('2026-10-02T00:00:00Z'),
      until: seconds('2026-10-02T00:00:00Z'),
    }, item => item.createdAt)
    expect(take(range, [oct3, oct2, oct1]).map(item => item.id)).toEqual(['oct2'])
  })

  it('keeps items whose timestamp cannot be parsed', () => {
    const range = createStreamRange<Item>({
      since: seconds('2026-10-02T00:00:00Z'),
      until: seconds('2026-10-02T00:00:00Z'),
    }, item => item.createdAt)
    const unknown: Item = { id: 'unknown', createdAt: 'now' }
    expect(take(range, [oct3, unknown, oct2, oct1]).map(item => item.id)).toEqual(['unknown', 'oct2'])
  })

  it('accepts YYYY-MM-DD date input', () => {
    const local = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString()
    const range = createStreamRange<Item>({ until: '2026-10-02' }, item => item.createdAt)
    const items: Item[] = [
      { id: 'oct3', createdAt: local(3) },
      { id: 'oct2', createdAt: local(2) },
    ]
    expect(take(range, items).map(item => item.id)).toEqual(['oct2'])
  })

  it('throws CONFIG_INVALID for invalid dates', () => {
    try {
      createStreamRange<Item>({ since: '2026-02-30' }, item => item.createdAt)
      throw new Error('expected createStreamRange to throw')
    }
    catch (error: any) {
      expect(error.code).toBe('CONFIG_INVALID')
    }
  })

  it('throws CONFIG_INVALID when a date bound has no timestamp reader', () => {
    try {
      createStreamRange<Item>({ since: '2026-10-01' })
      throw new Error('expected createStreamRange to throw')
    }
    catch (error: any) {
      expect(error.code).toBe('CONFIG_INVALID')
    }
  })

  it('normalizes maxItems', () => {
    expect(normalizeMaxItems(undefined)).toBe(Number.POSITIVE_INFINITY)
    expect(normalizeMaxItems(2.9)).toBe(2)
    expect(normalizeMaxItems(-1)).toBe(0)
  })
})
