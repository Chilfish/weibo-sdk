// tests/unit/errors/WeiboSDKError.test.ts
import { describe, expect, it } from 'vitest'
import { ConnectionTimeoutError } from '../../../src/models/errors/TransportError'

describe('weiboSDKError', () => {
  it('should have correct properties', () => {
    const error = new ConnectionTimeoutError('timeout')
    expect(error.code).toBe('NET_TIMEOUT')
    expect(error.level).toBe('transport')
    expect(error.retryable).toBe(true)
  })
})
