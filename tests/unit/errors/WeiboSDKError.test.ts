// tests/unit/errors/WeiboSDKError.test.ts
import { describe, expect, it } from 'vitest'
import { WeiboAPINotOkError, WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { ConnectionTimeoutError } from '~/models/errors/TransportError'

describe('weiboSDKError', () => {
  it('transport errors have correct properties', () => {
    const error = new ConnectionTimeoutError('timeout')
    expect(error).toBeInstanceOf(ConnectionTimeoutError)
    expect(error.code).toBe('NET_TIMEOUT')
    expect(error.level).toBe('transport')
    expect(error.retryable).toBe(true)
  })

  it('protocol errors have correct properties', () => {
    const error = new UnexpectedAPIResponseError('bad response', { endpoint: 'x' })
    expect(error.code).toBe('API_BAD_RESPONSE')
    expect(error.level).toBe('protocol')
    expect(error.retryable).toBe(false)
    expect(error.context).toEqual({ endpoint: 'x' })
  })

  it('business errors have correct properties', () => {
    const apiNotOk = new WeiboAPINotOkError('not ok', { ok: 0 })
    expect(apiNotOk.code).toBe('API_NOT_OK')
    expect(apiNotOk.level).toBe('business')
    expect(apiNotOk.retryable).toBe(false)
    expect(apiNotOk.context).toEqual({ ok: 0 })

    const expired = new WeiboSessionExpiredError('expired', { ok: 0 })
    expect(expired.code).toBe('AUTH_SESSION_EXPIRED')
    expect(expired.level).toBe('business')
    expect(expired.retryable).toBe(false)
  })
})
