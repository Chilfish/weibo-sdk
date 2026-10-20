import type { MediaType } from '~/types/domain/ITweet'
import { MediaInvalidResponseError } from '~/models/errors/MediaError'
import { MediaType as MediaTypeValue } from '~/types/domain/ITweet'

/** 单个媒体的落盘形态：图片（含 LivePhoto 静态帧）或视频（含 LivePhoto 动态帧）。 */
export type MediaVariant = 'image' | 'video'

/** `Content-Type` → 扩展名（仅覆盖微博媒体实际会出现的类型）。 */
export const MEDIA_CONTENT_TYPE_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
}

/** URL 兜底扩展名白名单；不在白名单内的扩展名不会被采用。 */
export const MEDIA_EXT_WHITELIST: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'heic',
  'heif',
  'avif',
  'mp4',
  'mov',
  'webm',
  'm4v',
])

/** 已知的非媒体响应类型；出现即视为错误页。 */
const REJECTED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'text/plain',
  'application/json',
  'application/xml',
  'text/xml',
])

const DEFAULT_EXT_BY_MEDIA_TYPE: Readonly<Record<MediaType, string>> = {
  [MediaTypeValue.PIC]: 'jpg',
  [MediaTypeValue.GIF]: 'gif',
  [MediaTypeValue.VIDEO]: 'mp4',
  [MediaTypeValue.LIVEPHOTO]: 'jpg',
  [MediaTypeValue.UNKNOWN]: 'bin',
}

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/**
 * 清理文件名片段：替换 Windows 非法字符与控制字符，去掉尾随 `.` / 空格，
 * 规避保留名，并截断到 60 字符。
 */
export function sanitizePathSegment(value: string, fallback: string): string {
  const cleaned = String(value)
    // eslint-disable-next-line no-control-regex -- 文件名必须剔除控制字符
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()

  if (!cleaned)
    return fallback

  const truncated = cleaned.slice(0, 60)
  return WINDOWS_RESERVED.test(truncated) ? `_${truncated}` : truncated
}

/** 读取 `Content-Type` 的媒体族；缺失或未知返回 `other`。 */
export function contentTypeFamily(contentType?: string): 'image' | 'video' | 'other' {
  const normalized = normalizeContentType(contentType)
  if (!normalized)
    return 'other'
  if (normalized.startsWith('image/'))
    return 'image'
  if (normalized.startsWith('video/'))
    return 'video'
  return 'other'
}

/** 是否为已知错误页类型（HTML / JSON / XML / 纯文本）。 */
export function isRejectedContentType(contentType?: string): boolean {
  const normalized = normalizeContentType(contentType)
  return normalized !== undefined && REJECTED_CONTENT_TYPES.has(normalized)
}

/**
 * 解析落盘扩展名：`Content-Type` → URL 后缀 → 媒体类型默认值。
 *
 * @throws `MediaInvalidResponseError` 响应类型不可接受，或媒体族与 variant 不符
 */
export function resolveExtension(input: {
  contentType?: string
  url: string
  type: MediaType
  variant: MediaVariant
}): string {
  const contentType = normalizeContentType(input.contentType)

  if (contentType && REJECTED_CONTENT_TYPES.has(contentType)) {
    throw new MediaInvalidResponseError(`Media response is not a media file: ${contentType}`, {
      reason: 'invalid-content-type',
      contentType,
      url: input.url,
    })
  }

  if (contentType) {
    const family = contentTypeFamily(contentType)
    if (family !== 'other') {
      if (input.variant === 'video' && family !== 'video') {
        throw new MediaInvalidResponseError('Expected a video response but received an image.', {
          reason: 'type-mismatch',
          contentType,
          variant: input.variant,
          url: input.url,
        })
      }
      if (input.variant === 'image' && family !== 'image') {
        throw new MediaInvalidResponseError('Expected an image response but received a video.', {
          reason: 'type-mismatch',
          contentType,
          variant: input.variant,
          url: input.url,
        })
      }
    }

    const mapped = MEDIA_CONTENT_TYPE_EXT[contentType]
    if (mapped)
      return mapped
  }

  const fromUrl = extensionFromUrl(input.url)
  if (fromUrl)
    return fromUrl

  return input.variant === 'video' ? 'mp4' : DEFAULT_EXT_BY_MEDIA_TYPE[input.type] ?? 'bin'
}

/** 构造扁平文件名：`<mblogId>-<index>-<mediaId>[-motion].<ext>`。 */
export function buildMediaFileName(input: {
  mblogId: string
  index: number
  mediaId: string
  type: MediaType
  variant: MediaVariant
  ext: string
}): string {
  const index = Number.isFinite(input.index) && input.index > 0 ? Math.floor(input.index) : 1
  const base = `${sanitizePathSegment(input.mblogId, 'tweet')}-${String(index).padStart(2, '0')}-${sanitizePathSegment(input.mediaId, 'media')}`
  const motion = input.type === MediaTypeValue.LIVEPHOTO && input.variant === 'video' ? '-motion' : ''
  return `${base}${motion}.${input.ext}`
}

/** 主机是否命中后缀白名单（`example.com` 同时匹配 `a.example.com`）。 */
export function isAllowedHost(host: string, suffixes: readonly string[]): boolean {
  const normalizedHost = host.trim().toLowerCase().replace(/\.$/, '')
  if (!normalizedHost)
    return false
  return suffixes.some((suffix) => {
    const normalizedSuffix = suffix.trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '')
    return normalizedSuffix !== ''
      && (normalizedHost === normalizedSuffix || normalizedHost.endsWith(`.${normalizedSuffix}`))
  })
}

function normalizeContentType(contentType?: string): string | undefined {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase()
  return normalized || undefined
}

function extensionFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname
    const lastSegment = pathname.split('/').pop() ?? ''
    const ext = lastSegment.includes('.') ? lastSegment.split('.').pop()?.toLowerCase() : undefined
    return ext && MEDIA_EXT_WHITELIST.has(ext) ? ext : undefined
  }
  catch {
    return undefined
  }
}
