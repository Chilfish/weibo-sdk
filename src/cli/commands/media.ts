import type { MediaDownloadItem, MediaDownloadOptions, MediaItemErrorContext, TweetMediaDownloadResult } from '~/types/media'
import { isAbsolute, join } from 'node:path'
import { defineCommand } from 'citty'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { MediaType } from '~/types/domain/ITweet'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK } from '../shared'

/** 解析 `--include`：逗号分隔、大小写不敏感、去重；未知值直接报错。 */
function parseInclude(value: unknown): MediaType[] | undefined {
  if (value === undefined)
    return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidConfigError('--include must be a non-empty comma-separated list.', {
      field: 'include',
      value,
    })
  }

  const allowed = new Set<string>(Object.values(MediaType))
  const result: MediaType[] = []
  for (const part of value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean)) {
    if (!allowed.has(part)) {
      throw new InvalidConfigError(`Unknown media type in --include: ${part}`, {
        field: 'include',
        value: part,
      })
    }
    const mediaType = part as MediaType
    if (!result.includes(mediaType))
      result.push(mediaType)
  }

  if (result.length === 0) {
    throw new InvalidConfigError('--include must contain at least one media type.', { field: 'include' })
  }
  return result
}

/** `--retries` 允许 0；其余数字参数用 `parsePositiveInt`。 */
function parseNonNegativeInt(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
  if (typeof value !== 'string' || value.trim() === '')
    return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * 把 CLI 参数解析为 SDK 选项（纯函数，便于离线单测）。
 *
 * @throws `InvalidConfigError` 缺少 mblogId、`--include` 非法
 */
export function resolveMediaCliOptions(
  args: Record<string, unknown>,
  cwd: string,
): { mblogId: string, options: MediaDownloadOptions } {
  const mblogId = typeof args.id === 'string' ? args.id.trim() : ''
  if (!mblogId) {
    throw new InvalidConfigError('media download requires a mblogId positional argument.', {
      field: 'mblogId',
    })
  }

  const out = typeof args.out === 'string' && args.out.trim() !== '' ? args.out.trim() : 'weibo-media'
  const dir = isAbsolute(out) ? out : join(cwd, out)
  const include = parseInclude(args.include)

  const options: MediaDownloadOptions = {
    dir,
    include,
    concurrency: parsePositiveInt(typeof args.concurrency === 'string' ? args.concurrency : undefined),
    retries: parseNonNegativeInt(args.retries),
    timeoutMs: parsePositiveInt(typeof args.timeout === 'string' ? args.timeout : undefined),
    idleTimeoutMs: parsePositiveInt(typeof args['idle-timeout'] === 'string' ? args['idle-timeout'] : undefined),
    maxBytes: parsePositiveInt(typeof args['max-bytes'] === 'string' ? args['max-bytes'] : undefined),
    overwrite: Boolean(args.overwrite),
    failFast: Boolean(args['fail-fast']),
    dryRun: Boolean(args['dry-run']),
    referer: typeof args.referer === 'string' ? args.referer : undefined,
    refreshExpired: typeof args.refresh === 'boolean' ? args.refresh : true,
  }

  return { mblogId, options }
}

/** 单项事件（NDJSON）。 */
export function toItemEvent(item: MediaDownloadItem, mblogId: string): Record<string, unknown> {
  const base = {
    event: 'item',
    mblogId,
    mediaId: item.mediaId,
    index: item.index,
    type: item.type,
    variant: item.variant,
    status: item.status,
    url: item.url,
    path: item.path,
    attempts: item.attempts,
  }

  switch (item.status) {
    case 'downloaded':
      return { ...base, bytes: item.bytes, contentType: item.contentType, refreshed: item.refreshed }
    case 'skipped':
      return { ...base, reason: item.reason, duplicateOf: item.duplicateOf, bytes: item.bytes }
    case 'planned':
      return base
    case 'failed':
      return {
        ...base,
        code: item.code,
        message: item.message,
        retryable: item.retryable,
        httpStatus: item.httpStatus,
      }
  }
}

/** 单项失败事件（stderr）。 */
export function toItemErrorEvent(context: MediaItemErrorContext, error: unknown): Record<string, unknown> {
  const weiboError = error instanceof WeiboSDKError ? error : undefined
  return {
    event: 'item-error',
    mblogId: context.mblogId,
    mediaId: context.mediaId,
    index: context.index,
    type: context.type,
    variant: context.variant,
    url: context.url,
    attempts: context.attempts,
    fatal: context.fatal,
    httpStatus: context.httpStatus,
    code: weiboError?.code,
    message: error instanceof Error ? error.message : String(error),
  }
}

/** 收尾事件。 */
export function toDoneEvent(result: TweetMediaDownloadResult): Record<string, unknown> {
  return {
    event: 'done',
    mblogId: result.mblogId,
    dir: result.dir,
    dryRun: result.dryRun,
    total: result.totals.total,
    downloaded: result.totals.downloaded,
    skipped: result.totals.skipped,
    failed: result.totals.failed,
    bytes: result.totals.bytes,
    errorsFile: result.errorsFile,
    durationMs: result.durationMs,
  }
}

export const mediaImages = defineCommand({
  meta: { name: 'images', description: '流式遍历用户图片墙（自动翻页 + 跨页去重）' },
  args: {
    'uid': { type: 'positional', description: '用户 UID', required: true },
    'since-id': { type: 'string', description: '起始游标（缺省第一页；下一页传上一页 sinceId）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const asset of createSDK(args).media.streamImages(args.uid, {
      sinceId: args['since-id'],
      maxPages: parsePositiveInt(args['max-pages']),
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, asset }))
    }
    console.log(JSON.stringify({ event: 'done', uid: args.uid, count }))
  },
})

export const mediaVideos = defineCommand({
  meta: { name: 'videos', description: '流式遍历用户视频瀑布（自动翻页 + 跨页去重）' },
  args: {
    'uid': { type: 'positional', description: '用户 UID', required: true },
    'cursor': { type: 'string', description: '起始游标（缺省第一页；下一页传上一页 cursor）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const asset of createSDK(args).media.streamVideos(args.uid, {
      cursor: args.cursor,
      maxPages: parsePositiveInt(args['max-pages']),
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, asset }))
    }
    console.log(JSON.stringify({ event: 'done', uid: args.uid, count }))
  },
})

export const mediaAlbums = defineCommand({
  meta: { name: 'albums', description: '获取用户相册列表（相册 tab 的 getImageWall?has_album=true）' },
  args: {
    uid: { type: 'positional', description: '用户 UID', required: true },
    ...cookieArg,
  },
  async run({ args }) {
    const result = await createSDK(args).media.listAlbums(args.uid)
    console.log(JSON.stringify(result, null, 2))
  },
})

export const mediaAlbum = defineCommand({
  meta: { name: 'album', description: '流式遍历相册照片（since_id 游标 + 跨页去重）' },
  args: {
    'container-id': { type: 'positional', description: '相册 containerId（来自 media albums）', required: true },
    'since-id': { type: 'string', description: '起始游标（缺省第一页；下一页传上一页 sinceId）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const asset of createSDK(args).media.streamAlbumPhotos(args['container-id'], {
      sinceId: args['since-id'],
      maxPages: parsePositiveInt(args['max-pages']),
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, asset }))
    }
    console.log(JSON.stringify({ event: 'done', containerId: args['container-id'], count }))
  },
})

export const mediaDownload = defineCommand({
  meta: { name: 'download', description: '下载单条微博的全部媒体（扁平目录 + 失败清单）' },
  args: {
    'id': { type: 'positional', description: '微博 mblogId', required: true },
    'out': { type: 'string', description: '输出目录（默认 <pwd>/weibo-media）', alias: 'o' },
    'include': { type: 'string', description: '媒体类型，逗号分隔：pic,video,livephoto,gif,unknown' },
    'concurrency': { type: 'string', description: '媒体并发（默认 3，上限 8）' },
    'retries': { type: 'string', description: '单个媒体最大重试次数（默认 2）' },
    'timeout': { type: 'string', description: '连接/首字节超时 ms（默认 30000）' },
    'idle-timeout': { type: 'string', description: '流式空闲超时 ms（默认 20000）' },
    'max-bytes': { type: 'string', description: '单文件字节上限（默认 512MiB）' },
    'overwrite': { type: 'boolean', description: '覆盖已存在文件（默认跳过）' },
    'fail-fast': { type: 'boolean', description: '首个失败立即中止' },
    'dry-run': { type: 'boolean', description: '只规划不下载' },
    'referer': { type: 'string', description: 'CDN Referer（默认 https://weibo.com/）' },
    'refresh': { type: 'boolean', default: true, description: '过期 URL 自动刷新（--no-refresh 关闭）' },
    ...cookieArg,
  },
  async run({ args }) {
    let resolved: ReturnType<typeof resolveMediaCliOptions>
    try {
      resolved = resolveMediaCliOptions(args as Record<string, unknown>, process.cwd())
    }
    catch (error) {
      console.error(JSON.stringify({
        event: 'error',
        code: error instanceof WeiboSDKError ? error.code : 'CONFIG_INVALID',
        message: error instanceof Error ? error.message : String(error),
      }))
      process.exit(1)
    }

    const controller = new AbortController()
    const abort = (): void => controller.abort()
    process.once('SIGINT', abort)
    process.once('SIGTERM', abort)

    const options = resolved.options
    options.signal = controller.signal
    options.onProgress = (progress) => {
      console.log(JSON.stringify({
        event: 'progress',
        mblogId: progress.mblogId,
        completed: progress.completed,
        total: progress.total,
        downloaded: progress.downloaded,
        skipped: progress.skipped,
        failed: progress.failed,
        bytes: progress.bytes,
      }))
      if (progress.current)
        console.log(JSON.stringify(toItemEvent(progress.current, progress.mblogId)))
    }
    options.onItemError = (error, context) => {
      console.error(JSON.stringify(toItemErrorEvent(context, error)))
    }

    try {
      const result = await createSDK(args).media.downloadByMblogId(resolved.mblogId, options)
      console.log(JSON.stringify(toDoneEvent(result)))
      if (result.totals.failed > 0)
        process.exitCode = 1
    }
    catch (error) {
      if (controller.signal.aborted) {
        console.error(JSON.stringify({ event: 'aborted', mblogId: resolved.mblogId }))
        process.exitCode = 130
      }
      else {
        console.error(JSON.stringify({
          event: 'error',
          mblogId: resolved.mblogId,
          code: error instanceof WeiboSDKError ? error.code : 'MEDIA_DOWNLOAD_FAILED',
          message: error instanceof Error ? error.message : String(error),
        }))
        process.exitCode = 1
      }
    }
    finally {
      process.removeListener('SIGINT', abort)
      process.removeListener('SIGTERM', abort)
    }
  },
})
