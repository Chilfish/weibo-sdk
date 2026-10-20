import type { IResolvedRetryPolicy } from '../RetryPolicy'
import type { WeiboRetryKind } from '~/types/config'
import { MediaDownloadError, MediaInvalidResponseError, MediaStorageError } from '~/models/errors/MediaError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { computeBackoffDelay, readRetryAfterMs, resolveRetryPolicy } from '../RetryPolicy'

/** 媒体下载默认重试参数（与 SDK 请求重试的默认值一致）。 */
export function buildMediaRetryPolicy(retries?: number): IResolvedRetryPolicy {
  return resolveRetryPolicy({ retries })
}

/** 判断错误是否属于「媒体 URL 已过期」，应触发重新拉取微博。 */
export function isExpiredError(error: unknown): boolean {
  if (!(error instanceof MediaDownloadError))
    return false
  if (error.context?.reason === 'expired')
    return true
  const status = error.context?.status
  return status === 403 || status === 404 || status === 410
}

/** 判断错误是否属于本地存储失败（不可重试，且应停止后续调度）。 */
export function isStorageError(error: unknown): boolean {
  return error instanceof MediaStorageError
}

/** 判断是否为取消错误。 */
export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted)
    return true
  return error instanceof Error && error.name === 'AbortError'
}

/** 把媒体错误映射为退避类别；不可重试返回 `undefined`。 */
export function classifyMediaError(error: unknown): WeiboRetryKind | undefined {
  if (error instanceof MediaInvalidResponseError || error instanceof MediaStorageError)
    return undefined

  if (error instanceof MediaDownloadError) {
    const status = error.context?.status
    const reason = error.context?.reason
    if (reason === 'expired')
      return undefined
    if (reason === 'rate-limit' || status === 429)
      return 'rate_limit'
    if (reason === 'timeout' || reason === 'idle-timeout' || status === 408)
      return 'timeout'
    if (typeof status === 'number' && status >= 500)
      return 'server_error'
    return 'network_error'
  }

  if (error instanceof WeiboSDKError)
    return undefined

  return 'network_error'
}

/** 计算媒体重试的退避延迟（复用 SDK 的指数退避 + jitter）。 */
export function computeMediaBackoff(options: {
  attempt: number
  policy: IResolvedRetryPolicy
  error: unknown
  random?: () => number
}): number {
  return computeBackoffDelay({
    attempt: options.attempt,
    policy: options.policy,
    retryAfterMs: readRetryAfterMs(options.error),
    random: options.random,
  })
}
