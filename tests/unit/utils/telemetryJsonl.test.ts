import type { TelemetryEvent } from '~/types/telemetry'
import type { ArchiveProgressEvent, TelemetryJsonlInput } from '~/utils/telemetryJsonl'
import { describe, expect, it } from 'vitest'
import {
  createJsonlTelemetry,
  formatArchiveProgress,
  isArchiveProgress,
  JSONL_MAX_VALUE_LENGTH,
  serializeTelemetryEvent,
  toJsonlRecord,
} from '~/utils/telemetryJsonl'
import { WeiboSDK } from '~/WeiboSDK'

/** 收集写出的行，便于断言「一行一事件」。 */
function createCollector() {
  const lines: string[] = []
  const telemetry = createJsonlTelemetry({
    write: (line) => {
      lines.push(line)
    },
  })
  return { lines, telemetry }
}

const requestStart: TelemetryEvent = {
  event_name: 'request_start',
  timestamp: 1_700_000_000_000,
  trace_id: 'trace-1',
  method: 'GET',
  url: 'https://weibo.com/ajax/statuses/mymblog',
  endpoint: 'TWEET_MYMBLOG',
  resource_type: 'TWEET_MYMBLOG',
}

const archiveProgress: TelemetryEvent = {
  event_name: 'archive_progress',
  timestamp: 1_700_000_000_100,
  trace_id: 'trace-2',
  uid: '1234567890',
  phase: 'timeline',
  processed: 25,
  total: 200,
  remaining: 175,
  source: 'mymblog',
  page: 2,
}

const rateLimitWait: TelemetryEvent = {
  event_name: 'rate_limit_wait',
  timestamp: 1_700_000_000_200,
  trace_id: 'trace-3',
  wait_ms: 800,
  refill_rate_ms: 1000,
  max_tokens: 3,
  tokens: 1,
}

describe('createJsonlTelemetry', () => {
  it('writes exactly one JSON line per event', async () => {
    const { lines, telemetry } = createCollector()

    for (const event of [requestStart, archiveProgress, rateLimitWait])
      await telemetry.emit(event)

    expect(telemetry.written).toBe(3)
    expect(telemetry.dropped).toBe(0)
    expect(lines).toHaveLength(3)

    // 每行以单个 \n 结尾，行内不含换行 → 可直接落 JSONL
    for (const line of lines) {
      expect(line.endsWith('\n')).toBe(true)
      expect(line.slice(0, -1)).not.toContain('\n')
    }

    const records = lines.map(line => JSON.parse(line))
    expect(records.map(record => record.event_name)).toEqual([
      'request_start',
      'archive_progress',
      'rate_limit_wait',
    ])
    expect(records[1]).toEqual({
      event_name: 'archive_progress',
      timestamp: 1_700_000_000_100,
      trace_id: 'trace-2',
      uid: '1234567890',
      phase: 'timeline',
      processed: 25,
      total: 200,
      remaining: 175,
      source: 'mymblog',
      page: 2,
    })
  })

  it('hands the original event to write and only exports filtered events', async () => {
    const lines: string[] = []
    const seen: TelemetryJsonlInput[] = []
    const telemetry = createJsonlTelemetry({
      write: (line, event) => {
        lines.push(line)
        seen.push(event)
      },
      filter: isArchiveProgress,
    })

    await telemetry.emit(requestStart)
    await telemetry.emit(archiveProgress)

    expect(telemetry.written).toBe(1)
    expect(telemetry.dropped).toBe(1)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).event_name).toBe('archive_progress')
    expect(seen).toEqual([archiveProgress])
  })

  it('never throws on write / filter failures', async () => {
    const event: TelemetryEvent = requestStart

    const syncThrow = createJsonlTelemetry({
      write: () => {
        throw new Error('disk full')
      },
    })
    await expect(syncThrow.emit(event)).resolves.toBeUndefined()
    expect(syncThrow.written).toBe(0)
    expect(syncThrow.dropped).toBe(1)

    const asyncThrow = createJsonlTelemetry({
      write: async () => {
        throw new Error('stream closed')
      },
    })
    await expect(asyncThrow.emit(event)).resolves.toBeUndefined()
    expect(asyncThrow.written).toBe(0)
    expect(asyncThrow.dropped).toBe(1)

    const brokenFilter = createJsonlTelemetry({
      write: () => {},
      filter: () => {
        throw new Error('filter exploded')
      },
    })
    await expect(brokenFilter.emit(event)).resolves.toBeUndefined()
    expect(brokenFilter.dropped).toBe(1)

    // 运行时防御：非对象事件也只计入 dropped
    await expect(asyncThrow.emit(undefined as unknown as TelemetryEvent)).resolves.toBeUndefined()
    expect(asyncThrow.dropped).toBe(2)
  })

  it('rejects a missing write function early', () => {
    expect(() => createJsonlTelemetry({} as unknown as Parameters<typeof createJsonlTelemetry>[0]))
      .toThrow(TypeError)
  })

  it('is accepted as WeiboSDK config.telemetry (offline: selfCheck none)', async () => {
    const { lines, telemetry } = createCollector()
    const sdk = new WeiboSDK({
      cookie: 'SUB=offline-test',
      telemetry,
      selfCheck: { mode: 'none' },
    })

    expect(sdk.archive).toBeDefined()

    await telemetry.emit(archiveProgress)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).event_name).toBe('archive_progress')
  })
})

describe('toJsonlRecord / serializeTelemetryEvent', () => {
  it('drops undefined and unsupported fields, flattens objects', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic

    const record = toJsonlRecord({
      event_name: 'normalize_done',
      timestamp: 1,
      trace_id: 'trace-x',
      model: 'Tweet',
      count: undefined,
      nothing: null,
      nested: { a: 1 },
      list: [1, 'two'],
      fn: () => 1,
      symbol: Symbol('sym'),
      big: 10n,
      nan: Number.NaN,
      when: new Date('2024-01-01T00:00:00.000Z'),
      cyclic,
    } as unknown as TelemetryEvent & Record<string, unknown>)

    expect(record).not.toHaveProperty('count')
    expect(record).not.toHaveProperty('fn')
    expect(record).not.toHaveProperty('symbol')
    expect(record.nothing).toBeNull()
    expect(record.nested).toBe('{"a":1}')
    expect(record.list).toBe('[1,"two"]')
    expect(record.big).toBe('10')
    expect(record.nan).toBeNull()
    expect(record.when).toBe('2024-01-01T00:00:00.000Z')
    expect(record.cyclic).toBe('[unserializable]')
  })

  it('caps oversized values and keeps a valid JSON line', () => {
    const line = serializeTelemetryEvent({
      event_name: 'normalize_done',
      timestamp: 1,
      trace_id: 'trace-y',
      model: 'Tweet',
      huge: 'x'.repeat(JSONL_MAX_VALUE_LENGTH * 2),
    } as unknown as TelemetryEvent & Record<string, unknown>)

    const record = JSON.parse(line)
    expect(typeof record.huge).toBe('string')
    expect(record.huge.length).toBe(JSONL_MAX_VALUE_LENGTH + 1) // 截断 + '…'
    expect(record.huge.endsWith('…')).toBe(true)
  })

  it('backfills a valid timestamp when missing or invalid', () => {
    const options = { now: () => 42 }

    expect(toJsonlRecord({ event_name: 'normalize_done', trace_id: 't' } as unknown as TelemetryEvent, options).timestamp)
      .toBe(42)
    expect(toJsonlRecord({ event_name: 'normalize_done', trace_id: 't', timestamp: Number.NaN } as unknown as TelemetryEvent, options).timestamp)
      .toBe(42)
    expect(toJsonlRecord({ event_name: 'normalize_done', trace_id: 't', timestamp: 7 } as unknown as TelemetryEvent, options).timestamp)
      .toBe(7)
  })
})

describe('formatArchiveProgress', () => {
  const base = { ...archiveProgress } as ArchiveProgressEvent

  it('computes percent and remaining from a full progress event', () => {
    const summary = formatArchiveProgress(base)

    expect(summary).toEqual({
      phase: 'timeline',
      processed: 25,
      total: 200,
      remaining: 175,
      percent: 12.5,
      text: 'timeline 25/200 (12.5%) · 175 remaining',
    })
  })

  it('derives remaining from total - processed when absent', () => {
    const summary = formatArchiveProgress({ ...base, processed: 30, total: 40, remaining: undefined })

    expect(summary.remaining).toBe(10)
    expect(summary.percent).toBe(75)
    expect(summary.text).toBe('timeline 30/40 (75%) · 10 remaining')
  })

  it('handles unknown total, zero total and out-of-range progress', () => {
    const unknownTotal = formatArchiveProgress({ ...base, processed: 3, total: undefined, remaining: undefined })
    expect(unknownTotal.total).toBeUndefined()
    expect(unknownTotal.percent).toBeUndefined()
    expect(unknownTotal.remaining).toBeUndefined()
    expect(unknownTotal.text).toBe('timeline 3 processed (total unknown)')

    const zeroTotal = formatArchiveProgress({ ...base, processed: 0, total: 0, remaining: undefined })
    expect(zeroTotal.percent).toBe(0)
    expect(zeroTotal.remaining).toBe(0)

    const overshoot = formatArchiveProgress({ ...base, processed: 260, total: 200, remaining: undefined })
    expect(overshoot.percent).toBe(100)
    expect(overshoot.remaining).toBe(0)
  })

  it('is usable as a predicate filter', () => {
    expect(isArchiveProgress(base)).toBe(true)
    expect(isArchiveProgress(requestStart)).toBe(false)
    expect(isArchiveProgress(undefined)).toBe(false)
  })
})
