import type { WeiboRetryKind } from '~/types/config'
import { describe, expect, it } from 'vitest'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { ConnectionTimeoutError, NetworkRequestError, RateLimitError } from '~/models/errors/TransportError'
import {
  classifyRetryableError,
  computeBackoffDelay,
  DEFAULT_RETRY_POLICY,
  MAX_RETRIES,
  parseRetryAfter,
  readRetryAfterMs,
  resolveRetryPolicy,
} from '~/services/internal/RetryPolicy'

const NOW = Date.parse('2026-01-01T00:00:00Z')

describe('resolveRetryPolicy', () => {
  it('falls back to the default policy (2 retries / 500ms base / 8s cap / all kinds)', () => {
    const policy = resolveRetryPolicy()

    expect(policy).toEqual(DEFAULT_RETRY_POLICY)
    expect(policy.retries).toBe(2)
    expect(policy.baseDelayMs).toBe(500)
    expect(policy.maxDelayMs).toBe(8000)
    expect([...policy.retryOn]).toEqual(['rate_limit', 'server_error', 'timeout', 'network_error'])
  })

  it('merges partial config and keeps optional fields backward compatible', () => {
    const policy = resolveRetryPolicy({ retries: 0, retryOn: ['rate_limit'] })

    expect(policy.retries).toBe(0)
    expect(policy.baseDelayMs).toBe(500)
    expect(policy.maxDelayMs).toBe(8000)
    expect(policy.retryOn).toEqual(['rate_limit'])
  })

  it('clamps invalid values and caps retries to avoid unbounded retrying', () => {
    const policy = resolveRetryPolicy({
      retries: Number.POSITIVE_INFINITY,
      baseDelayMs: -1,
      maxDelayMs: Number.NaN,
    })

    expect(policy.retries).toBe(MAX_RETRIES)
    expect(policy.baseDelayMs).toBe(DEFAULT_RETRY_POLICY.baseDelayMs)
    expect(policy.maxDelayMs).toBe(DEFAULT_RETRY_POLICY.maxDelayMs)
  })

  it('never lets maxDelayMs fall below baseDelayMs', () => {
    const policy = resolveRetryPolicy({ baseDelayMs: 1000, maxDelayMs: 100 })
    expect(policy.maxDelayMs).toBe(1000)
  })

  it('filters unknown retryOn entries and keeps an explicit empty list', () => {
    const unknownKind = 'nope' as unknown as WeiboRetryKind
    expect(resolveRetryPolicy({ retryOn: ['rate_limit', unknownKind] }).retryOn)
      .toEqual(['rate_limit'])
    expect(resolveRetryPolicy({ retryOn: [] }).retryOn).toEqual([])
  })
})

describe('classifyRetryableError', () => {
  it('maps 432/429 to rate_limit and timeouts to timeout', () => {
    expect(classifyRetryableError(new RateLimitError('limited', { status: 432, attempt: 1 })))
      .toBe('rate_limit')
    expect(classifyRetryableError(new ConnectionTimeoutError('timeout')))
      .toBe('timeout')
  })

  it('maps 5xx to server_error and response-less failures to network_error', () => {
    expect(classifyRetryableError(new NetworkRequestError('boom', { status: 503 })))
      .toBe('server_error')
    expect(classifyRetryableError(new NetworkRequestError('boom', { status: 500 })))
      .toBe('server_error')
    expect(classifyRetryableError(new NetworkRequestError('reset', {})))
      .toBe('network_error')
  })

  it('never retries other 4xx, business or protocol errors', () => {
    expect(classifyRetryableError(new NetworkRequestError('not found', { status: 404 })))
      .toBeUndefined()
    expect(classifyRetryableError(new WeiboAPINotOkError('ok=0', { ok: 0 })))
      .toBeUndefined()
    expect(classifyRetryableError(new UnexpectedAPIResponseError('bad schema')))
      .toBeUndefined()
    expect(classifyRetryableError(new Error('raw error')))
      .toBeUndefined()
  })
})

describe('parseRetryAfter', () => {
  it('parses delay-seconds strings and numbers into milliseconds', () => {
    expect(parseRetryAfter('2', NOW)).toBe(2000)
    expect(parseRetryAfter('0.5', NOW)).toBe(500)
    expect(parseRetryAfter(' 3 ', NOW)).toBe(3000)
    expect(parseRetryAfter(4, NOW)).toBe(4000)
    expect(parseRetryAfter(['5'], NOW)).toBe(5000)
  })

  it('parses HTTP dates relative to now', () => {
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:02 GMT', NOW)).toBe(2000)
  })

  it('returns undefined for invalid or expired values', () => {
    expect(parseRetryAfter(undefined, NOW)).toBeUndefined()
    expect(parseRetryAfter('', NOW)).toBeUndefined()
    expect(parseRetryAfter('soon', NOW)).toBeUndefined()
    expect(parseRetryAfter('Wed, 31 Dec 2025 00:00:00 GMT', NOW)).toBeUndefined()
  })
})

describe('computeBackoffDelay', () => {
  const policy = resolveRetryPolicy({ retries: 5, baseDelayMs: 100, maxDelayMs: 1000 })

  it('applies jitter in [50%, 100%] of the exponential step', () => {
    expect(computeBackoffDelay({ attempt: 1, policy, random: () => 0 })).toBe(50)
    expect(computeBackoffDelay({ attempt: 1, policy, random: () => 1 })).toBe(100)
    expect(computeBackoffDelay({ attempt: 3, policy, random: () => 0 })).toBe(200)
    expect(computeBackoffDelay({ attempt: 3, policy, random: () => 1 })).toBe(400)
  })

  it('grows exponentially but never exceeds maxDelayMs', () => {
    expect(computeBackoffDelay({ attempt: 5, policy, random: () => 1 })).toBe(1000)
    expect(computeBackoffDelay({ attempt: 20, policy, random: () => 1 })).toBe(1000)
  })

  it('prefers Retry-After and clamps it to maxDelayMs', () => {
    expect(computeBackoffDelay({ attempt: 1, policy, retryAfterMs: 800, random: () => 0 })).toBe(800)
    expect(computeBackoffDelay({ attempt: 1, policy, retryAfterMs: 9000, random: () => 0 })).toBe(1000)
  })

  it('treats invalid attempt values as the first attempt', () => {
    expect(computeBackoffDelay({ attempt: Number.NaN, policy, random: () => 1 })).toBe(100)
    expect(computeBackoffDelay({ attempt: 0, policy, random: () => 1 })).toBe(100)
  })
})

describe('readRetryAfterMs', () => {
  it('reads retryAfterMs from structured error context', () => {
    expect(readRetryAfterMs(new RateLimitError('limited', { status: 432, retryAfterMs: 1500 })))
      .toBe(1500)
    expect(readRetryAfterMs(new RateLimitError('limited', { status: 432 })))
      .toBeUndefined()
    expect(readRetryAfterMs(new Error('raw'))).toBeUndefined()
  })
})
