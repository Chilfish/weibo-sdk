import type { MediaType } from './domain/ITweet'

/** 单个媒体的落盘形态：图片（含 LivePhoto 静态帧）或视频（含 LivePhoto 动态帧）。 */
export type MediaVariant = 'image' | 'video'

/** `sdk.media.downloadTweetMedia` / `downloadByMblogId` 的选项。 */
export interface MediaDownloadOptions {
  /** 输出目录（必填；SDK 内解析为绝对路径） */
  dir: string
  /** 参与的媒体类型（默认全部，含 UNKNOWN） */
  include?: MediaType[]
  /** 媒体并发（默认 3，clamp 1..8） */
  concurrency?: number
  /** 单个媒体最大重试次数（默认 2，clamp 0..10） */
  retries?: number
  /** 连接/首字节超时毫秒数（默认 30000） */
  timeoutMs?: number
  /** 流式读取空闲超时毫秒数（默认 20000） */
  idleTimeoutMs?: number
  /** 单文件字节上限（默认 512MiB） */
  maxBytes?: number
  /** 目标已存在且非空时覆盖（默认 false → 跳过） */
  overwrite?: boolean
  /** CDN Referer（默认 `https://weibo.com/`） */
  referer?: string
  /** 允许的媒体主机后缀（默认 `DEFAULT_MEDIA_ALLOWED_HOSTS`） */
  allowedHosts?: string[]
  /** 403/404/410 时重新拉取微博换新 URL（默认 true，每条微博最多 1 次） */
  refreshExpired?: boolean
  /** 只规划，不联网、不落盘、不 stat（默认 false） */
  dryRun?: boolean
  /** 取消信号 */
  signal?: AbortSignal
  /** 首个失败即中止（含取消在途下载，默认 false） */
  failFast?: boolean
  /** 每完成一项回调；回调抛错不影响流程 */
  onProgress?: (progress: MediaDownloadProgress) => void | Promise<void>
  /** 单项失败回调；回调抛错不掩盖原始错误 */
  onItemError?: (error: unknown, context: MediaItemErrorContext) => void | Promise<void>
}

/** 单项失败的上下文。 */
export interface MediaItemErrorContext {
  mblogId: string
  mediaId: string
  index: number
  type: MediaType
  variant: MediaVariant
  url: string
  attempts: number
  /** 是否属于本地存储失败（会停止后续调度） */
  fatal: boolean
  httpStatus?: number
}

/** 进度快照；`current` 为刚刚结束的那一项。 */
export interface MediaDownloadProgress {
  mblogId: string
  /** 已结束项数（downloaded + skipped + failed + planned） */
  completed: number
  /** 计划项总数（含 skipped） */
  total: number
  downloaded: number
  skipped: number
  failed: number
  /** 成功下载的字节数 */
  bytes: number
  current?: MediaDownloadItem
}

export interface MediaDownloadItemBase {
  mediaId: string
  /** 原始 `tweet.media` 中的 1-based 位置（过滤前后不变） */
  index: number
  type: MediaType
  variant: MediaVariant
  /** 实际使用的 URL（video/livephoto 取 videoUrl，其余取 imageUrl） */
  url: string
  /** 最终绝对路径；dryRun 下为计划路径；过滤/无 URL 时为空串 */
  path: string
  /** 尝试次数（含首次；skipped/planned 为 0） */
  attempts: number
}

export type MediaSkipReason
  = | 'exists'
    | 'filtered-out'
    | 'no-url'
    | 'duplicate-id'
    | 'duplicate-url'
    | 'aborted'

export type MediaDownloadItem
  = | (MediaDownloadItemBase & {
    status: 'downloaded'
    bytes: number
    contentType?: string
    refreshed: boolean
  })
  | (MediaDownloadItemBase & {
    status: 'skipped'
    reason: MediaSkipReason
    duplicateOf?: string
    bytes?: number
  })
  | (MediaDownloadItemBase & { status: 'planned' })
  | (MediaDownloadItemBase & {
    status: 'failed'
    error: unknown
    code: string
    message: string
    retryable: boolean
    httpStatus?: number
  })

export interface MediaDownloadTotals {
  total: number
  downloaded: number
  skipped: number
  failed: number
  /** 仅规划、未执行（dry-run，或 `failFast` 中止后）的条目数；`downloaded + skipped + failed + planned === total` */
  planned: number
  bytes: number
}

export interface TweetMediaDownloadResult {
  mblogId: string
  dir: string
  dryRun: boolean
  /** 顺序 = 原始 media 顺序；LivePhoto 的 image/video 相邻 */
  items: MediaDownloadItem[]
  failures: Array<Extract<MediaDownloadItem, { status: 'failed' }>>
  totals: MediaDownloadTotals
  /** 有失败且非 dryRun 时的失败清单路径 */
  errorsFile?: string
  durationMs: number
}
