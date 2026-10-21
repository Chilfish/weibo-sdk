import type { WeiboLogger, WeiboLogRecord } from '~/types/logging'
import { describe, expect, it, vi } from 'vitest'
import {
  combineTelemetry,
  createConsoleLogger,
  createJsonlLogger,
  createLoggerBridge,
  createLoggerPlugin,
  createMultiLogger,
  isLogLevelEnabled,
  levelForEvent,
  redactLogRecord,
  toLogRecord,
} from '~/utils/logger'

const requestStart = {
  event_name: 'request_start',
  timestamp: 1_700_000_000_000,
  trace_id: 'trace-1',
  method: 'GET',
  url: 'https://weibo.com/ajax/statuses/mymblog',
  endpoint: 'TWEET_MYMBLOG',
} as const

const requestError = {
  event_name: 'request_error',
  timestamp: 1_700_000_000_100,
  trace_id: 'trace-2',
  phase: 'request',
  error_name: 'NetworkRequestError',
  error_message: 'boom',
  error_code: 'NET_REQUEST_FAILED',
  error_retryable: true,
  duration_ms: 12,
  cookie: 'SUB=secret',
} as const

function createCollector(): { lines: string[], logger: WeiboLogger } {
  const lines: string[] = []
  const logger = createConsoleLogger({
    level: 'debug',
    stream: { write: chunk => lines.push(chunk) },
  })
  return { lines, logger }
}

describe('levelForEvent', () => {
  it('maps error / warn / debug / default info', () => {
    expect(levelForEvent('request_error')).toBe('error')
    expect(levelForEvent('self_check_error')).toBe('error')
    expect(levelForEvent('request_retry')).toBe('warn')
    expect(levelForEvent('rate_limit_wait')).toBe('warn')
    expect(levelForEvent('request_start')).toBe('debug')
    expect(levelForEvent('archive_progress')).toBe('debug')
    expect(levelForEvent('request_success')).toBe('info')
    expect(levelForEvent('normalize_done')).toBe('info')
    expect(levelForEvent('unknown_event')).toBe('info')
  })

  it('compares levels by rank', () => {
    expect(isLogLevelEnabled('debug')).toBe(true)
    expect(isLogLevelEnabled('debug', 'info')).toBe(false)
    expect(isLogLevelEnabled('warn', 'info')).toBe(true)
    expect(isLogLevelEnabled('error', 'warn')).toBe(true)
    expect(isLogLevelEnabled('info', 'error')).toBe(false)
  })
})

describe('toLogRecord', () => {
  it('keeps primitive fields and drops nested values', () => {
    const record = toLogRecord(requestStart as never)
    expect(record).toEqual({
      level: 'debug',
      event_name: 'request_start',
      timestamp: 1_700_000_000_000,
      trace_id: 'trace-1',
      method: 'GET',
      url: 'https://weibo.com/ajax/statuses/mymblog',
      endpoint: 'TWEET_MYMBLOG',
    })
  })

  it('expands self_check_error into name / message', () => {
    const error = new Error('cookie expired')
    error.name = 'WeiboSessionExpiredError'

    const record = toLogRecord({
      event_name: 'self_check_error',
      timestamp: 1,
      trace_id: 'trace-3',
      error,
    })

    expect(record).toEqual({
      level: 'error',
      event_name: 'self_check_error',
      timestamp: 1,
      trace_id: 'trace-3',
      error_name: 'WeiboSessionExpiredError',
      error_message: 'cookie expired',
    })
  })

  it('stringifies non-Error lifecycle errors', () => {
    const record = toLogRecord({
      event_name: 'self_check_error',
      timestamp: 1,
      trace_id: 'trace-4',
      error: 'plain failure',
    })
    expect(record.error_message).toBe('plain failure')
    expect(record).not.toHaveProperty('error')
  })
})

describe('redactLogRecord', () => {
  it('redacts sensitive keys without touching credential_id', () => {
    const record = redactLogRecord({
      'level': 'error',
      'event_name': 'request_error',
      'cookie': 'SUB=secret',
      'set-cookie': 'SUB=secret',
      'x-xsrf-token': 'token-value',
      'authorization': 'Bearer abc',
      'access_token': 'abc',
      'sub': '123',
      'subp': '456',
      'credential_id': 'cookie-1234abcd',
      'message': 'weibo failed',
    })

    expect(record.cookie).toBe('[redacted]')
    expect(record['set-cookie']).toBe('[redacted]')
    expect(record['x-xsrf-token']).toBe('[redacted]')
    expect(record.authorization).toBe('[redacted]')
    expect(record.access_token).toBe('[redacted]')
    expect(record.sub).toBe('[redacted]')
    expect(record.subp).toBe('[redacted]')
    expect(record.credential_id).toBe('cookie-1234abcd')
    expect(record.message).toBe('weibo failed')
  })
})

describe('createConsoleLogger', () => {
  it('writes one JSON line and backfills timestamp', () => {
    const lines: string[] = []
    const logger = createConsoleLogger({
      level: 'debug',
      now: () => 42,
      stream: { write: chunk => lines.push(chunk) },
    })

    logger.log({ level: 'info', event_name: 'custom', endpoint: 'X' })

    expect(lines).toHaveLength(1)
    expect(lines[0].endsWith('\n')).toBe(true)
    expect(JSON.parse(lines[0])).toEqual({
      level: 'info',
      event_name: 'custom',
      timestamp: 42,
      endpoint: 'X',
    })
  })

  it('filters below the configured level', () => {
    const { lines, logger } = createCollector()

    logger.log({ level: 'debug', event_name: 'debug_event' })
    logger.log({ level: 'info', event_name: 'info_event' })

    expect(lines.map(line => JSON.parse(line).event_name)).toEqual(['debug_event', 'info_event'])
  })

  it('redacts sensitive fields by default and can be disabled', () => {
    const lines: string[] = []
    const logger = createConsoleLogger({
      level: 'debug',
      stream: { write: chunk => lines.push(chunk) },
    })

    logger.log({ level: 'error', event_name: 'request_error', cookie: 'SUB=secret' })
    expect(JSON.parse(lines[0]).cookie).toBe('[redacted]')

    const rawLines: string[] = []
    const rawLogger = createConsoleLogger({
      level: 'debug',
      redact: false,
      stream: { write: chunk => rawLines.push(chunk) },
    })
    rawLogger.log({ level: 'error', event_name: 'request_error', cookie: 'SUB=secret' })
    expect(JSON.parse(rawLines[0]).cookie).toBe('SUB=secret')
  })

  it('renders a readable pretty line', () => {
    const lines: string[] = []
    const logger = createConsoleLogger({
      level: 'debug',
      format: 'pretty',
      now: () => Date.UTC(2024, 0, 1),
      stream: { write: chunk => lines.push(chunk) },
    })

    logger.log({ level: 'warn', event_name: 'request_retry', endpoint: 'X', message: 'two words' })

    expect(lines[0]).toContain('2024-01-01T00:00:00.000Z')
    expect(lines[0]).toContain('WARN')
    expect(lines[0]).toContain('request_retry')
    expect(lines[0]).toContain('endpoint=X')
    expect(lines[0]).toContain('message="two words"')
  })

  it('never throws when the stream fails', () => {
    const logger = createConsoleLogger({
      level: 'debug',
      stream: {
        write: () => {
          throw new Error('EPIPE')
        },
      },
    })

    expect(() => logger.log({ level: 'error', event_name: 'request_error' })).not.toThrow()
  })
})

describe('createJsonlLogger', () => {
  it('writes one line per record and counts output', async () => {
    const lines: string[] = []
    const logger = createJsonlLogger({
      level: 'debug',
      write: (line) => {
        lines.push(line)
      },
    })

    await logger.log(toLogRecord(requestStart as never))
    await logger.log(toLogRecord(requestError as never))

    expect(logger.written).toBe(2)
    expect(logger.dropped).toBe(0)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).event_name).toBe('request_start')
    expect(JSON.parse(lines[1]).error_message).toBe('boom')
  })

  it('counts filtered records and swallows write failures', async () => {
    const logger = createJsonlLogger({
      level: 'info',
      filter: record => record.event_name === 'request_error',
      write: () => {
        throw new Error('disk full')
      },
    })

    await logger.log({ ...toLogRecord(requestStart as never), level: 'info' })
    expect(logger.dropped).toBe(1)
    expect(logger.written).toBe(0)

    await logger.log(toLogRecord(requestError as never))
    expect(logger.dropped).toBe(2)
    expect(logger.written).toBe(0)
  })

  it('rejects a missing write function early', () => {
    expect(() => createJsonlLogger({} as never)).toThrow(TypeError)
  })
})

describe('createMultiLogger', () => {
  it('fans out to every sink and isolates failures', () => {
    const seen: string[] = []
    const healthy: WeiboLogger = {
      log: (record) => {
        seen.push(record.event_name)
      },
    }
    const broken: WeiboLogger = {
      log: () => {
        throw new Error('sink down')
      },
    }

    const logger = createMultiLogger([broken, healthy])
    expect(logger.level).toBeUndefined()
    expect(() => logger.log({ level: 'info', event_name: 'request_success' })).not.toThrow()
    expect(seen).toEqual(['request_success'])
  })
})

describe('createLoggerBridge', () => {
  it('returns undefined without a logger (default silent)', () => {
    expect(createLoggerBridge()).toBeUndefined()
  })

  it('filters events below the logger level', () => {
    const seen: WeiboLogRecord[] = []
    const logger: WeiboLogger = {
      level: 'error',
      log: (record) => {
        seen.push(record)
      },
    }

    const bridge = createLoggerBridge(logger)!
    bridge.event(requestStart as never)
    bridge.event(requestError as never)

    expect(seen).toHaveLength(1)
    expect(seen[0].event_name).toBe('request_error')
  })

  it('delivers lifecycle events and never leaks logger failures', () => {
    const seen: string[] = []
    const logger: WeiboLogger = {
      level: 'debug',
      log(record) {
        seen.push(record.event_name)
        if (record.event_name === 'request_error')
          throw new Error('sync sink failure')
        if (record.event_name === 'request_start')
          return Promise.reject(new Error('async sink failure'))
      },
    }

    const bridge = createLoggerBridge(logger)!
    expect(() => bridge.lifecycle({
      event_name: 'sdk_init',
      timestamp: 1,
      trace_id: 't',
    })).not.toThrow()
    expect(() => bridge.event(requestStart as never)).not.toThrow()
    expect(() => bridge.event(requestError as never)).not.toThrow()
    expect(seen).toEqual(['sdk_init', 'request_start', 'request_error'])
  })
})

describe('combineTelemetry', () => {
  it('returns the existing sink when one side is missing', () => {
    const sink = { emit: vi.fn() }
    expect(combineTelemetry(sink)).toBe(sink)
    expect(combineTelemetry(undefined, sink)).toBe(sink)
    expect(combineTelemetry()).toBeUndefined()
  })

  it('isolates failures between sinks', async () => {
    const seen: string[] = []
    const broken = {
      emit: () => {
        throw new Error('down')
      },
    }
    const healthy = {
      emit: (event: { event_name: string }) => {
        seen.push(event.event_name)
      },
    }

    const combined = combineTelemetry(broken, healthy)!
    await expect(combined.emit(requestStart as never)).resolves.toBeUndefined()
    expect(seen).toEqual(['request_start'])
  })
})

describe('createLoggerPlugin', () => {
  it('is a v1 observer that forwards events to the logger', () => {
    const seen: string[] = []
    const plugin = createLoggerPlugin({
      level: 'debug',
      log: (record) => {
        seen.push(record.event_name)
      },
    })

    expect(plugin.name).toBe('logger')
    expect(plugin.apiVersion).toBe(1)

    plugin.observe!(requestStart as never)
    expect(seen).toEqual(['request_start'])
  })
})
