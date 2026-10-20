import { WeiboSDKError } from './WeiboSDKError'

/**
 * 媒体 CDN 传输层失败：5xx / 429 / 408 / 超时 / 连接重置 / 空闲超时 / 截断 / 零字节。
 *
 * `context.reason` 区分具体原因；`context.status` 为上游 HTTP 状态码（若适用）。
 */
export class MediaDownloadError extends WeiboSDKError {
  readonly code = 'MEDIA_DOWNLOAD_FAILED'
  readonly level = 'transport'
  readonly retryable = true
}

/**
 * 媒体响应不可接受：HTML/JSON 错误页、类型族不符、超过字节上限、非法重定向、非 2xx 不可重试码。
 */
export class MediaInvalidResponseError extends WeiboSDKError {
  readonly code = 'MEDIA_BAD_RESPONSE'
  readonly level = 'protocol'
  readonly retryable = false
}

/**
 * 本地落盘失败：mkdir / write / rename / unlink（ENOSPC、EACCES、EPERM、EBUSY 等）。
 *
 * 存储错误不可重试，且会停止后续媒体调度，避免继续写坏磁盘。
 */
export class MediaStorageError extends WeiboSDKError {
  readonly code = 'MEDIA_STORAGE_FAILED'
  readonly level = 'storage'
  readonly retryable = false
}
