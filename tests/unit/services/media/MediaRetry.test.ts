import { describe, expect, it } from 'vitest'
import { MediaDownloadError, MediaInvalidResponseError, MediaStorageError } from '~/models/errors/MediaError'
import {
  buildMediaRetryPolicy,
  classifyMediaError,
  computeMediaBackoff,
  isAbortError,
  isExpiredError,
  isStorageError,
} from '~/services/internal/media/MediaRetry'

describe('mediaRetry', () => {
  it('clamps retry counts', () => {
    expect(buildMediaRetryPolicy(-1).retries).toBe(0)
    expect(buildMediaRetryPolicy(99).retries).toBe(10)
    expect(buildMediaRetryPolicy(Number.NaN).retries).toBe(2)
  })

  it('classifies retryable media errors', () => {
    expect(classifyMediaError(new MediaDownloadError('x', { status: 500 }))).toBe('server_error')
    expect(classifyMediaError(new MediaDownloadError('x', { status: 429 }))).toBe('rate_limit')
    expect(classifyMediaError(new MediaDownloadError('x', { status: 408 }))).toBe('timeout')
    expect(classifyMediaError(new MediaDownloadError('x', { reason: 'idle-timeout' }))).toBe('timeout')
    expect(classifyMediaError(new MediaDownloadError('x', { reason: 'network' }))).toBe('network_error')
  })

  it('does not retry expired, protocol or storage errors', () => {
    const expired = new MediaDownloadError('x', { status: 403, reason: 'expired' })
    expect(isExpiredError(expired)).toBe(true)
    expect(classifyMediaError(expired)).toBeUndefined()
    expect(classifyMediaError(new MediaInvalidResponseError('x'))).toBeUndefined()
    expect(classifyMediaError(new MediaStorageError('x'))).toBeUndefined()
    expect(isStorageError(new MediaStorageError('x'))).toBe(true)
  })

  it('detects aborts', () => {
    const controller = new AbortController()
    controller.abort()
    expect(isAbortError(new Error('x'), controller.signal)).toBe(true)
    const error = new Error('x')
    error.name = 'AbortError'
    expect(isAbortError(error)).toBe(true)
  })

  it('computes deterministic exponential backoff with injected random', () => {
    const policy = buildMediaRetryPolicy(2)
    expect(computeMediaBackoff({ attempt: 1, policy, error: new Error('x'), random: () => 0 })).toBe(250)
    expect(computeMediaBackoff({ attempt: 2, policy, error: new Error('x'), random: () => 0 })).toBe(500)
    expect(computeMediaBackoff({ attempt: 3, policy, error: new Error('x'), random: () => 1 })).toBe(2000)
  })
})
