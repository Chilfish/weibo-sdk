// tests/unit/errors/WeiboSDKError.test.ts
import { describe, expect, it } from 'vitest'
import { WeiboAPINotOkError, WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { ConnectionTimeoutError, NetworkRequestError, RateLimitError } from '~/models/errors/TransportError'

describe('weiboSDKError', () => {
  it('transport errors have correct properties', () => {
    const error = new ConnectionTimeoutError('timeout')
    expect(error).toBeInstanceOf(ConnectionTimeoutError)
    expect(error.code).toBe('NET_TIMEOUT')
    expect(error.level).toBe('transport')
    expect(error.retryable).toBe(true)
  })

  it('rate limit errors are retryable transport errors with structured context', () => {
    const error = new RateLimitError('limited', { status: 432, retryAfterMs: 2000, attempt: 2 })

    expect(error).not.toBeInstanceOf(ConnectionTimeoutError)
    expect(error).not.toBeInstanceOf(NetworkRequestError)
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.level).toBe('transport')
    expect(error.retryable).toBe(true)
    expect(error.context).toEqual({ status: 432, retryAfterMs: 2000, attempt: 2 })
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
