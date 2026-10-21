import type { IWeiboConfig } from '~/types/config'
import type { WeiboLogger, WeiboLogRecord } from '~/types/logging'
import { describe, expect, it, vi } from 'vitest'
import { TransportFailure } from '~/services/internal/transport'
import { WeiboSDK } from '~/WeiboSDK'

function createLogger(level: WeiboLogRecord['level'] = 'debug') {
  const records: WeiboLogRecord[] = []
  const logger: WeiboLogger = {
    level,
    log: (record) => {
      records.push(record)
    },
  }
  return { logger, records }
}

function createFailingSdk(logger?: WeiboLogger, telemetry?: IWeiboConfig['telemetry']) {
  return new WeiboSDK({
    cookie: 'SUB=offline-test',
    logger,
    telemetry,
    selfCheck: { mode: 'none' },
    retry: { retries: 0 },
    transport: {
      async send() {
        throw new TransportFailure('network', 'offline')
      },
    },
  })
}

describe('weiboSDK logger', () => {
  it('stays silent by default', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const sdk = new WeiboSDK({ cookie: 'SUB=offline-test', selfCheck: { mode: 'none' } })
    void sdk
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(log).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()

    log.mockRestore()
    error.mockRestore()
    warn.mockRestore()
  })

  it('delivers sdk_init to the configured logger', async () => {
    const { logger, records } = createLogger()
    const sdk = new WeiboSDK({
      cookie: 'SUB=offline-test',
      logger,
      selfCheck: { mode: 'none' },
    })
    void sdk

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(records).toEqual([
      expect.objectContaining({
        level: 'debug',
        event_name: 'sdk_init',
        trace_id: expect.any(String),
        timestamp: expect.any(Number),
      }),
    ])
  })

  it('fans out request events to telemetry and logger without double-emitting', async () => {
    const { logger, records } = createLogger()
    const telemetry = { emit: vi.fn() }
    const sdk = createFailingSdk(logger, telemetry)

    await expect(sdk.users.getById('1234567890')).rejects.toMatchObject({
      code: 'NET_REQUEST_FAILED',
    })

    const loggerEvents = records.map(record => record.event_name)
    expect(loggerEvents).toContain('request_start')
    expect(loggerEvents).toContain('request_error')

    const telemetryEvents = telemetry.emit.mock.calls.map(([event]) => event.event_name)
    expect(telemetryEvents).toContain('request_start')
    expect(telemetryEvents).toContain('request_error')
  })

  it('does not create a telemetry sink when neither telemetry nor logger is configured', async () => {
    const sdk = createFailingSdk()

    await expect(sdk.users.getById('1234567890')).rejects.toBeTruthy()
  })
})
