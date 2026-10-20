import type { ImageWallResponse, WaterfallResponse } from '../endpoints/media'
import type { MediaDownloaderResult, ResolvedMediaOptions } from '../internal/media/MediaDownloader'
import type { MediaFileStore } from '../internal/media/MediaFileStore'
import type { MediaHttpClient } from '../internal/media/MediaHttpClient'
import type { MediaTimers } from '../internal/media/MediaStreamWriter'
import type { IRateLimitClock } from '../internal/RateLimitService'
import type { IWeiboConfig } from '~/types/config'
import type { ITweet } from '~/types/domain/ITweet'
import type { IUserAlbum, IUserMediaAsset } from '~/types/domain/IUserMediaAsset'
import type {
  MediaDownloadItem,
  MediaDownloadOptions,
  TweetMediaDownloadResult,
} from '~/types/media'
import type { StreamLimitOptions } from '~/utils/streamRange'
import { normalizeAlbum, normalizeImageWallItem, normalizeWaterfallVideo } from '~/models/data/Media'
import { Tweet } from '~/models/data/Tweet'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { MediaType } from '~/types/domain/ITweet'
import { createStreamRange } from '~/utils/streamRange'
import { normalizeTweetIdInput } from '~/utils/tweetId'
import { albumDetailSpec, imageWallSpec, waterfallSpec } from '../endpoints/media'
import { statusShowSpec } from '../endpoints/tweet'
import { FetcherService } from '../internal/FetcherService'
import { MediaDownloader } from '../internal/media/MediaDownloader'
import { createNodeMediaFileStore } from '../internal/media/MediaFileStore'
import { createAxiosMediaHttpClient, DEFAULT_MEDIA_ALLOWED_HOSTS } from '../internal/media/MediaHttpClient'
import { sanitizePathSegment } from '../internal/media/MediaNaming'

/** 图片墙单页结果（`listImages` 返回值）。 */
export interface ImageWallPageResult {
  /** 下一页游标（上游 `data.since_id`；缺省表示到底） */
  sinceId?: string
  /** 是否可能还有下一页（空页 / 游标缺失 / 游标不前进时为 `false`） */
  hasMore: boolean
  /** 本页归一化后的媒体资产（已过滤空 `pid`） */
  assets: IUserMediaAsset[]
}

/** `listImages` 的选项。 */
export interface ImageWallListOptions {
  /** 起始游标（缺省 / `0` / `-1` = 第一页；下一页传上一页的 `sinceId`） */
  sinceId?: string | number
}

/** 视频瀑布单页结果（`listVideos` 返回值）。 */
export interface VideoWaterfallPageResult {
  /** 下一页游标（上游 `data.next_cursor`；缺省表示到底） */
  cursor?: string
  /** 是否可能还有下一页（空页 / 游标缺失 / 游标不前进时为 `false`） */
  hasMore: boolean
  /** 本页提取出的视频资产（非视频条目会被跳过） */
  assets: IUserMediaAsset[]
}

/** `listVideos` 的选项。 */
export interface VideoWaterfallListOptions {
  /** 起始游标（缺省 / `0` / `-1` = 第一页；下一页传上一页的 `cursor`） */
  cursor?: string | number
}

/** 媒体流进度（每页触发一次）。 */
export interface MediaStreamProgress {
  /** 用户 UID */
  uid: string
  /** 数据源：图片墙 / 视频瀑布 */
  source: 'image' | 'video'
  /** 本次请求使用的游标（首屏为 `0`） */
  cursor: string
  /** 页码（从 1 开始，按请求轮次递增） */
  page: number
  /** 已产出的资产数（跨页去重后） */
  processed: number
  /** 本页去重前的条目数 */
  pageSize: number
}

/** `streamImages` 的选项。 */
export interface ImageWallStreamOptions extends ImageWallListOptions, StreamLimitOptions {
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；异常不会中断流 */
  onProgress?: (progress: MediaStreamProgress) => void | Promise<void>
}

/** `streamVideos` 的选项。 */
export interface VideoWaterfallStreamOptions extends VideoWaterfallListOptions, StreamLimitOptions {
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；异常不会中断流 */
  onProgress?: (progress: MediaStreamProgress) => void | Promise<void>
}

/** 相册列表结果（`listAlbums` 返回值）。 */
export interface AlbumListResult {
  /** 相册列表（containerId 为空 / 标题为空的条目不参与归一化） */
  albums: IUserAlbum[]
}

/** 相册流进度（每页触发一次）。 */
export interface AlbumStreamProgress {
  /** 相册 containerId */
  containerId: string
  /** 本次请求使用的游标（首屏为 `0`） */
  cursor: string
  /** 页码（从 1 开始） */
  page: number
  /** 已产出的照片数（跨页去重后） */
  processed: number
  /** 本页去重前的条目数 */
  pageSize: number
}

/** 相册照片单页结果（`listAlbumPhotos` 返回值）。 */
export interface AlbumPhotoPageResult {
  /** 下一页游标（上游 `data.since_id`；`0` / 缺省表示到底） */
  sinceId?: string
  /** 是否可能还有下一页（空页 / 游标缺失 / 游标不前进时为 `false`） */
  hasMore: boolean
  /** 本页归一化后的照片资产（已过滤空 `pid`） */
  assets: IUserMediaAsset[]
}

/** `listAlbumPhotos` 的选项。 */
export interface AlbumPhotoListOptions {
  /** 起始游标（缺省 / `0` / `-1` = 第一页；下一页传上一页的 `sinceId`） */
  sinceId?: string | number
}

/** `streamAlbumPhotos` 的选项。 */
export interface AlbumPhotoStreamOptions extends AlbumPhotoListOptions, StreamLimitOptions {
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；异常不会中断流 */
  onProgress?: (progress: AlbumStreamProgress) => void | Promise<void>
}

/** 下载相关的可注入依赖（测试用；默认使用 Node 文件系统与独立 axios 客户端）。 */
export interface MediaServiceDownloadDeps {
  http?: MediaHttpClient
  /** `null` 强制模拟无文件系统环境 */
  fileStore?: MediaFileStore | null
  clock?: IRateLimitClock
  now?: () => number
  random?: () => number
  timers?: MediaTimers
}

/** 游标归一化：缺省 / 空串 / `0` / `-1` 统一为第一页哨兵 `0`；其余原样字符串化。 */
function normalizeCursor(cursor?: string | number): string {
  if (cursor === undefined || cursor === null)
    return '0'
  const text = String(cursor).trim()
  if (text === '' || text === '0' || text === '-1')
    return '0'
  return text
}

/** 翻页上限归一化：缺省 / 非有限数 = 不限；其余取非负整数。 */
function normalizeMaxPages(maxPages?: number): number {
  if (maxPages === undefined || !Number.isFinite(maxPages))
    return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(maxPages))
}

/** 判断上游游标是否还能继续翻页（非空、非 0、且与本次请求游标不同）。 */
function canAdvance(next: string | undefined, current: string, rawCount: number): boolean {
  return rawCount > 0
    && next !== undefined
    && next !== ''
    && next !== '0'
    && next !== '-1'
    && next !== current
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function booleanOr(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function resolveInclude(values?: MediaType[]): ReadonlySet<MediaType> {
  const all = Object.values(MediaType) as MediaType[]
  if (values === undefined)
    return new Set(all)
  if (!Array.isArray(values) || values.length === 0) {
    throw new InvalidConfigError('Media download include must not be empty.', { field: 'include' })
  }
  const allowed = new Set<string>(all)
  const result = new Set<MediaType>()
  for (const value of values) {
    if (typeof value !== 'string' || !allowed.has(value)) {
      throw new InvalidConfigError(`Unknown media type in include: ${String(value)}`, {
        field: 'include',
        value,
      })
    }
    result.add(value)
  }
  return result
}

function resolveReferer(value?: string): string {
  const referer = typeof value === 'string' && value.trim() !== '' ? value.trim() : 'https://weibo.com/'
  try {
    const parsed = new URL(referer)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      throw new Error('invalid protocol')
  }
  catch {
    throw new InvalidConfigError(`Media download referer must be an http(s) URL: ${referer}`, {
      field: 'referer',
      value,
    })
  }
  return referer
}

function resolveAllowedHosts(value?: string[]): readonly string[] {
  if (value === undefined)
    return DEFAULT_MEDIA_ALLOWED_HOSTS
  if (!Array.isArray(value) || value.length === 0 || value.some(host => typeof host !== 'string' || host.trim() === '')) {
    throw new InvalidConfigError('Media download allowedHosts must be a non-empty string array.', {
      field: 'allowedHosts',
      value,
    })
  }
  return value.map(host => host.trim())
}

function resolveDownloadOptions(
  options: MediaDownloadOptions,
  mblogId: string,
  timers?: MediaTimers,
  defaultTimeoutMs = 30000,
): ResolvedMediaOptions {
  if (typeof mblogId !== 'string' || mblogId.trim() === '') {
    throw new InvalidConfigError('Media download requires a non-empty mblogId.', { field: 'mblogId' })
  }
  if (!options || typeof options.dir !== 'string' || options.dir.trim() === '') {
    throw new InvalidConfigError('Media download requires a non-empty dir.', { field: 'dir' })
  }

  return {
    dir: options.dir.trim(),
    include: resolveInclude(options.include),
    concurrency: clampNumber(options.concurrency, 3, 1, 8),
    retries: clampNumber(options.retries, 2, 0, 10),
    timeoutMs: clampNumber(options.timeoutMs, defaultTimeoutMs, 1000, 600000),
    idleTimeoutMs: clampNumber(options.idleTimeoutMs, 20000, 1000, 300000),
    maxBytes: clampNumber(options.maxBytes, 512 * 1024 * 1024, 1, 4 * 1024 ** 3),
    overwrite: booleanOr(options.overwrite, false),
    referer: resolveReferer(options.referer),
    allowedHosts: resolveAllowedHosts(options.allowedHosts),
    refreshExpired: booleanOr(options.refreshExpired, true),
    dryRun: booleanOr(options.dryRun, false),
    signal: options.signal,
    failFast: booleanOr(options.failFast, false),
    onProgress: options.onProgress,
    onItemError: options.onItemError,
    timers,
  }
}

function errorDescription(error: unknown): {
  error_name: string
  error_message: string
  error_code?: string
  error_level?: WeiboSDKError['level']
  error_retryable?: boolean
} {
  const weiboError = error instanceof WeiboSDKError ? error : undefined
  return {
    error_name: error instanceof Error ? error.name : typeof error,
    error_message: error instanceof Error ? error.message : String(error),
    error_code: weiboError?.code,
    error_level: weiboError?.level,
    error_retryable: weiboError?.retryable,
  }
}

function errorRecord(item: Extract<MediaDownloadItem, { status: 'failed' }>): Record<string, unknown> {
  const weiboError = item.error instanceof WeiboSDKError ? item.error : undefined
  return {
    mediaId: item.mediaId,
    index: item.index,
    type: item.type,
    variant: item.variant,
    url: item.url,
    path: item.path,
    attempts: item.attempts,
    code: item.code,
    level: weiboError?.level,
    retryable: item.retryable,
    httpStatus: item.httpStatus,
    message: item.message,
    context: weiboError?.context,
  }
}

/**
 * 用户媒体集合服务（D4 / D5）与单条微博媒体下载。
 *
 * - 图片墙：`GET /ajax/profile/getImageWall`，游标为 `sinceid`；
 * - 视频瀑布：`GET /ajax/profile/getWaterFallContent`，游标为 `cursor`；
 * - 下载：`downloadTweetMedia` / `downloadByMblogId`，使用独立 CDN 客户端（不携带 Cookie）。
 */
export class MediaService extends FetcherService {
  /**
   * @param mediaConfig SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   * @param downloadDeps 下载依赖覆盖（HTTP / 文件系统 / 时钟），主要用于测试注入
   */
  constructor(
    private readonly mediaConfig: IWeiboConfig,
    deps?: ConstructorParameters<typeof FetcherService>[1],
    private readonly downloadDeps: MediaServiceDownloadDeps = {},
  ) {
    super(mediaConfig, deps)
  }

  /**
   * 拉取一页图片墙原始响应（未归一化；归档层用于生成 `schemaDigest`）。
   *
   * @param uid 用户 UID
   * @param options 分页选项（`options.sinceId` 为起始游标）
   */
  public async fetchRawImagePage(uid: string, options: ImageWallListOptions = {}): Promise<ImageWallResponse> {
    const sinceId = normalizeCursor(options.sinceId)
    return await this.request(imageWallSpec, { uid, sinceid: sinceId })
  }

  /**
   * 拉取一页视频瀑布原始响应（未归一化；归档层用于生成 `schemaDigest` 并归一化微博）。
   *
   * @param uid 用户 UID
   * @param options 分页选项（`options.cursor` 为起始游标）
   */
  public async fetchRawVideoPage(uid: string, options: VideoWaterfallListOptions = {}): Promise<WaterfallResponse> {
    const cursor = normalizeCursor(options.cursor)
    return await this.request(waterfallSpec, { uid, cursor })
  }

  /**
   * 获取用户相册列表（D4）。
   *
   * 复用相册 tab 的真实请求：`getImageWall?uid=&sinceid=0&has_album=true`，
   * 从 `data.album_list` 读取 `pc_profile_album` 形态的 containerid（可直接进入 `listAlbumPhotos`）。
   *
   * @param uid 用户 UID
   * @returns 相册列表（过滤 containerid 为空的条目）
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async listAlbums(uid: string): Promise<AlbumListResult> {
    const startAt = Date.now()
    const raw = await this.request(imageWallSpec, { uid, sinceid: 0, has_album: true })
    const albums = (raw.data.album_list ?? [])
      .map(normalizeAlbum)
      .filter(album => album.containerId.length > 0)

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'UserAlbum',
      count: albums.length,
      duration_ms: Date.now() - startAt,
    })

    return { albums }
  }

  /**
   * 获取并归一化一页相册照片（D4，`GET /ajax/profile/getAlbumDetail`）。
   *
   * @param containerId 相册 containerid（来自 `listAlbums`）
   * @param options 分页选项
   * @param options.sinceId 起始游标（缺省 = 第一页；下一页传上一页 `sinceId`）
   * @returns 本页照片资产 + 下一页游标 + `hasMore`
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async listAlbumPhotos(containerId: string, options: AlbumPhotoListOptions = {}): Promise<AlbumPhotoPageResult> {
    const sinceId = normalizeCursor(options.sinceId)
    const startAt = Date.now()
    const raw = await this.request(albumDetailSpec, { containerid: containerId, since_id: sinceId })
    const assets = raw.data.list
      .map(normalizeImageWallItem)
      .filter(asset => asset.id.length > 0)

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'UserMediaAsset',
      count: assets.length,
      duration_ms: Date.now() - startAt,
    })

    const nextSinceId = raw.data.since_id === undefined || raw.data.since_id === null
      ? undefined
      : String(raw.data.since_id)
    return {
      sinceId: nextSinceId,
      hasMore: canAdvance(nextSinceId, sinceId, raw.data.list.length),
      assets,
    }
  }

  /**
   * 流式遍历相册照片（`since_id` 游标自动翻页 + 跨页按 `pid` 去重）。
   *
   * 停止条件（任一命中）：空页 / 无新条目（整页重复）/ `maxPages`。
   *
   * @example
   * for await (const photo of sdk.media.streamAlbumPhotos(album.containerId)) {
   *   console.log(photo.id, photo.url)
   * }
   */
  async* streamAlbumPhotos(containerId: string, options: AlbumPhotoStreamOptions = {}): AsyncIterableIterator<IUserMediaAsset> {
    const maxPages = normalizeMaxPages(options.maxPages)
    const range = createStreamRange<IUserMediaAsset>(options)
    const seen = new Set<string>()
    let cursor = normalizeCursor(options.sinceId)
    let pages = 0
    let processed = 0

    while (pages < maxPages) {
      const result = await this.listAlbumPhotos(containerId, { sinceId: cursor })
      pages += 1
      if (result.assets.length === 0)
        break

      const fresh = result.assets.filter((asset) => {
        if (seen.has(asset.id))
          return false
        seen.add(asset.id)
        return true
      })
      if (fresh.length === 0)
        break

      for (const asset of fresh) {
        const decision = range.decide(asset)
        if (decision === 'stop')
          break
        if (decision === 'skip')
          continue
        processed += 1
        yield asset
      }

      try {
        await options.onProgress?.({
          containerId,
          cursor,
          page: pages,
          processed,
          pageSize: result.assets.length,
        })
      }
      catch {
        // 进度回调异常不影响流
      }

      if (range.stopped)
        break
      if (!result.hasMore || result.sinceId === undefined)
        break
      cursor = result.sinceId
    }
  }

  /**
   * 获取并归一化一页图片墙。
   *
   * @param uid 用户 UID
   * @param options 分页选项
   * @param options.sinceId 起始游标（缺省 = 第一页）
   * @returns 本页媒体资产 + 下一页游标 + `hasMore`
   *
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async listImages(uid: string, options: ImageWallListOptions = {}): Promise<ImageWallPageResult> {
    const startAt = Date.now()
    const raw = await this.fetchRawImagePage(uid, options)
    const sinceId = normalizeCursor(options.sinceId)
    const assets = raw.data.list
      .map(normalizeImageWallItem)
      .filter(asset => asset.id.length > 0)

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'UserMediaAsset',
      count: assets.length,
      duration_ms: Date.now() - startAt,
    })

    const nextSinceId = raw.data.since_id === undefined || raw.data.since_id === null
      ? undefined
      : String(raw.data.since_id)
    return {
      sinceId: nextSinceId,
      hasMore: canAdvance(nextSinceId, sinceId, raw.data.list.length),
      assets,
    }
  }

  /**
   * 流式遍历图片墙（游标自动翻页 + 跨页按 `pid` 去重）。
   *
   * 停止条件（任一命中）：空页 / 无新条目（整页重复）/ `maxPages`。
   *
   * @example
   * for await (const asset of sdk.media.streamImages('1111681197', { maxPages: 2 })) {
   *   console.log(asset.id, asset.url)
   * }
   */
  async* streamImages(uid: string, options: ImageWallStreamOptions = {}): AsyncIterableIterator<IUserMediaAsset> {
    const maxPages = normalizeMaxPages(options.maxPages)
    const range = createStreamRange<IUserMediaAsset>(options)
    const seen = new Set<string>()
    let cursor = normalizeCursor(options.sinceId)
    let pages = 0
    let processed = 0

    while (pages < maxPages) {
      const result = await this.listImages(uid, { sinceId: cursor })
      pages += 1
      if (result.assets.length === 0)
        break

      const fresh = result.assets.filter((asset) => {
        if (seen.has(asset.id))
          return false
        seen.add(asset.id)
        return true
      })
      if (fresh.length === 0)
        break

      for (const asset of fresh) {
        const decision = range.decide(asset)
        if (decision === 'stop')
          break
        if (decision === 'skip')
          continue
        processed += 1
        yield asset
      }

      try {
        await options.onProgress?.({
          uid,
          source: 'image',
          cursor,
          page: pages,
          processed,
          pageSize: result.assets.length,
        })
      }
      catch {
        // 进度回调异常不影响流
      }

      if (range.stopped)
        break
      if (!result.hasMore || result.sinceId === undefined)
        break
      cursor = result.sinceId
    }
  }

  /**
   * 获取并归一化一页视频瀑布。
   *
   * @param uid 用户 UID
   * @param options 分页选项
   * @param options.cursor 起始游标（缺省 = 第一页）
   * @returns 本页视频资产 + 下一页游标 + `hasMore`
   *
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async listVideos(uid: string, options: VideoWaterfallListOptions = {}): Promise<VideoWaterfallPageResult> {
    const startAt = Date.now()
    const raw = await this.fetchRawVideoPage(uid, options)
    const cursor = normalizeCursor(options.cursor)
    const assets = raw.data.list
      .map(normalizeWaterfallVideo)
      .filter((asset): asset is IUserMediaAsset => asset !== undefined)

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'UserMediaAsset',
      count: assets.length,
      duration_ms: Date.now() - startAt,
    })

    const nextCursor = raw.data.next_cursor === undefined || raw.data.next_cursor === null
      ? undefined
      : String(raw.data.next_cursor)
    return {
      cursor: nextCursor,
      hasMore: canAdvance(nextCursor, cursor, raw.data.list.length),
      assets,
    }
  }

  /**
   * 流式遍历视频瀑布（游标自动翻页 + 跨页按资产 id 去重）。
   *
   * 停止条件（任一命中）：空页 / 无新条目（整页重复）/ `maxPages`。
   *
   * @example
   * for await (const asset of sdk.media.streamVideos('1111681197', { maxPages: 2 })) {
   *   console.log(asset.sourceMblogId, asset.url)
   * }
   */
  async* streamVideos(uid: string, options: VideoWaterfallStreamOptions = {}): AsyncIterableIterator<IUserMediaAsset> {
    const maxPages = normalizeMaxPages(options.maxPages)
    const range = createStreamRange<IUserMediaAsset>(options)
    const seen = new Set<string>()
    let cursor = normalizeCursor(options.cursor)
    let pages = 0
    let processed = 0

    while (pages < maxPages) {
      const result = await this.listVideos(uid, { cursor })
      pages += 1
      if (result.assets.length === 0)
        break

      const fresh = result.assets.filter((asset) => {
        if (seen.has(asset.id))
          return false
        seen.add(asset.id)
        return true
      })
      if (fresh.length === 0)
        break

      for (const asset of fresh) {
        const decision = range.decide(asset)
        if (decision === 'stop')
          break
        if (decision === 'skip')
          continue
        processed += 1
        yield asset
      }

      try {
        await options.onProgress?.({
          uid,
          source: 'video',
          cursor,
          page: pages,
          processed,
          pageSize: result.assets.length,
        })
      }
      catch {
        // 进度回调异常不影响流
      }

      if (range.stopped)
        break
      if (!result.hasMore || result.cursor === undefined)
        break
      cursor = result.cursor
    }
  }

  /**
   * 下载一条已归一化微博的媒体。
   *
   * 不额外拉取微博；仅在媒体 URL 过期（403/404/410）且 `refreshExpired` 为 true 时
   * 重新拉取一次该微博换新 URL。
   *
   * @param tweet 已归一化微博（可为 `Tweet` 或任意 `ITweet`）
   * @param options 下载选项
   * @returns 逐项结果、失败清单路径与统计
   *
   * @throws `InvalidConfigError`（选项非法 / 无 Node 文件系统）、取消错误、`failFast` 时的首个媒体错误
   */
  public async downloadTweetMedia(
    tweet: ITweet,
    options: MediaDownloadOptions,
  ): Promise<TweetMediaDownloadResult> {
    const resolved = resolveDownloadOptions(options, tweet.mblogId, this.downloadDeps.timers, this.mediaConfig.timeout ?? 30000)
    const store = this.downloadDeps.fileStore === null
      ? undefined
      : this.downloadDeps.fileStore ?? createNodeMediaFileStore()
    if (!store) {
      throw new InvalidConfigError('Media download requires a Node filesystem (node:fs).', {
        field: 'runtime',
      })
    }

    resolved.dir = store.resolve(resolved.dir)

    const http = this.downloadDeps.http ?? createAxiosMediaHttpClient({
      proxyUrl: this.mediaConfig.proxyUrl,
    })
    const traceId = this.newTraceId()
    const userOnItemError = resolved.onItemError
    let refreshed = 0

    resolved.onItemError = async (error, context) => {
      await this.emitTelemetry({
        event_name: 'media_download_item_error',
        timestamp: Date.now(),
        trace_id: traceId,
        mblogId: context.mblogId,
        media_id: context.mediaId,
        index: context.index,
        media_type: context.type,
        variant: context.variant,
        attempts: context.attempts,
        http_status: context.httpStatus,
        fatal: context.fatal,
        ...errorDescription(error),
      })
      await userOnItemError?.(error, context)
    }

    await this.emitTelemetry({
      event_name: 'media_download_start',
      timestamp: Date.now(),
      trace_id: traceId,
      mblogId: tweet.mblogId,
      dry_run: resolved.dryRun,
      concurrency: resolved.concurrency,
    })

    const downloader = new MediaDownloader({
      http,
      store,
      clock: this.downloadDeps.clock,
      now: this.downloadDeps.now,
      random: this.downloadDeps.random,
      refresh: resolved.refreshExpired ? () => this.refreshTweet(tweet.mblogId) : undefined,
    })

    const result = await downloader.run(tweet, resolved)
    refreshed = result.items.filter((item): item is Extract<MediaDownloadItem, { status: 'downloaded' }> => {
      return item.status === 'downloaded' && item.refreshed
    }).length

    const errorsFile = await this.writeMediaErrors(store, tweet.mblogId, resolved.dir, resolved.dryRun, result)

    await this.emitTelemetry({
      event_name: 'media_download_done',
      timestamp: Date.now(),
      trace_id: traceId,
      mblogId: tweet.mblogId,
      total: result.totals.total,
      downloaded: result.totals.downloaded,
      skipped: result.totals.skipped,
      failed: result.totals.failed,
      planned: result.totals.planned,
      bytes: result.totals.bytes,
      duration_ms: result.durationMs,
      refreshed,
    })

    return {
      mblogId: tweet.mblogId,
      dir: resolved.dir,
      dryRun: resolved.dryRun,
      items: result.items,
      failures: result.failures,
      totals: result.totals,
      errorsFile,
      durationMs: result.durationMs,
    }
  }

  /**
   * 先按微博 id 拉取微博（不补长文），再下载其媒体。
   *
   * @param mblogId 微博 id：mblogId / 数字 mid / 微博状态 URL（自动归一化）
   * @param options 下载选项
   */
  public async downloadByMblogId(
    mblogId: string,
    options: MediaDownloadOptions,
  ): Promise<TweetMediaDownloadResult> {
    const id = normalizeTweetIdInput(mblogId)
    const tweet = await this.getTweetForMedia(id)
    return this.downloadTweetMedia(tweet, options)
  }

  private async getTweetForMedia(mblogId: string): Promise<Tweet> {
    const raw = await this.request(statusShowSpec, {
      id: normalizeTweetIdInput(mblogId),
      isGetLongText: false,
    })
    return new Tweet(raw)
  }

  private async refreshTweet(mblogId: string): Promise<ITweet> {
    return this.getTweetForMedia(mblogId)
  }

  private async writeMediaErrors(
    store: MediaFileStore,
    mblogId: string,
    dir: string,
    dryRun: boolean,
    result: MediaDownloaderResult,
  ): Promise<string | undefined> {
    if (dryRun)
      return undefined

    const file = store.resolve(dir, `${sanitizePathSegment(mblogId, 'tweet')}-media-errors.json`)
    if (result.failures.length === 0) {
      await store.unlink(file)
      return undefined
    }

    const payload = {
      schemaVersion: 1,
      mblogId,
      generatedAt: new Date().toISOString(),
      dir,
      totals: result.totals,
      failures: result.failures.map(errorRecord),
    }
    await store.writeFile(file, JSON.stringify(payload, null, 2))
    return file
  }
}
