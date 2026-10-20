import type { IRateLimitClock } from '../RateLimitService'
import type { MediaFileStore } from './MediaFileStore'
import type { MediaHttpClient, MediaHttpResponse } from './MediaHttpClient'
import type { MediaTimers } from './MediaStreamWriter'
import type { ITweet, MediaType, TweetMedia } from '~/types/domain/ITweet'
import type {
  MediaDownloadItem,
  MediaDownloadItemBase,
  MediaDownloadOptions,
  MediaDownloadTotals,
  MediaItemErrorContext,
  MediaVariant,
} from '~/types/media'
import { MediaInvalidResponseError } from '~/models/errors/MediaError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { MediaType as MediaTypeValue } from '~/types/domain/ITweet'
import { defaultClock } from '../RateLimitService'
import { buildMediaFileName, resolveExtension } from './MediaNaming'
import { buildMediaRetryPolicy, classifyMediaError, computeMediaBackoff, isAbortError, isExpiredError, isStorageError } from './MediaRetry'
import { MediaSemaphore } from './MediaSemaphore'
import { persistStream } from './MediaStreamWriter'

/** 归一化后的下载选项（`MediaService` 负责补默认值）。 */
export interface ResolvedMediaOptions extends Required<Omit<MediaDownloadOptions, 'include' | 'signal' | 'onProgress' | 'onItemError' | 'allowedHosts'>> {
  include: ReadonlySet<MediaType>
  allowedHosts: readonly string[]
  signal?: AbortSignal
  onProgress?: MediaDownloadOptions['onProgress']
  onItemError?: MediaDownloadOptions['onItemError']
  timers?: MediaTimers
}

export interface MediaDownloaderDeps {
  http: MediaHttpClient
  store: MediaFileStore
  clock?: IRateLimitClock
  now?: () => number
  random?: () => number
  /** 过期刷新：返回重新拉取的微博；未提供表示禁用刷新。 */
  refresh?: () => Promise<ITweet>
}

export interface MediaDownloaderResult {
  items: MediaDownloadItem[]
  failures: Array<Extract<MediaDownloadItem, { status: 'failed' }>>
  totals: MediaDownloadTotals
  durationMs: number
}

interface EffectiveMedia {
  media: TweetMedia[]
  source: 'tweet' | 'repost' | 'retweeted'
}

interface PlannedTask {
  order: number
  mblogId: string
  item: MediaDownloadItemBase
  media: TweetMedia
  variant: MediaVariant
  source: 'tweet' | 'repost' | 'retweeted'
}

interface PlanResult {
  skipped: Array<{ order: number, item: MediaDownloadItem }>
  tasks: PlannedTask[]
  dryRunItems: Array<{ order: number, item: MediaDownloadItem }>
}

interface DownloadCounters {
  downloaded: number
  skipped: number
  failed: number
  bytes: number
  completed: number
}

function createAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason
  if (reason instanceof Error)
    return reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  if (active.length === 0)
    return undefined
  if (active.length === 1)
    return active[0]

  const anySignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  if (typeof anySignal === 'function')
    return anySignal(active)

  const controller = new AbortController()
  const abort = (): void => {
    const aborted = active.find(signal => signal.aborted)
    controller.abort(aborted?.reason)
  }
  for (const signal of active) {
    if (signal.aborted) {
      abort()
      break
    }
    signal.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

/**
 * 合并一条微博可下载的全部媒体：本层 `media` + 转发链各层配图 + 被转发原微博媒体。
 *
 * 转发链配图（reppic）不在 `media` 里，只在 `repostChain[].media`；按 `id + type` 去重，
 * 保证同一张图不会因上游重复下发而重复下载。
 */
function effectiveMedia(tweet: ITweet): EffectiveMedia {
  const media: TweetMedia[] = []
  const seen = new Set<string>()
  const push = (list: TweetMedia[] | undefined): void => {
    for (const item of list ?? []) {
      const key = `${item.id}:${item.type}`
      if (seen.has(key))
        continue
      seen.add(key)
      media.push(item)
    }
  }

  push(tweet.media)
  const repostMedia = tweet.repostChain?.flatMap(entry => entry.media)
  push(repostMedia)
  push(tweet.retweetedStatus?.media)

  if (repostMedia && repostMedia.length > 0)
    return { media, source: 'repost' }
  if (tweet.media.length > 0)
    return { media, source: 'tweet' }
  if (tweet.retweetedStatus?.media.length)
    return { media, source: 'retweeted' }
  return { media, source: 'tweet' }
}

function variantsFor(media: TweetMedia): Array<{ variant: MediaVariant, url: string }> {
  if (media.type === MediaTypeValue.LIVEPHOTO) {
    return [
      { variant: 'image', url: media.imageUrl },
      { variant: 'video', url: media.videoUrl ?? '' },
    ]
  }
  if (media.type === MediaTypeValue.VIDEO)
    return [{ variant: 'video', url: media.videoUrl ?? '' }]
  return [{ variant: 'image', url: media.imageUrl }]
}

function baseItem(input: {
  media: TweetMedia
  index: number
  variant: MediaVariant
  url: string
  path?: string
  attempts?: number
}): MediaDownloadItemBase {
  return {
    mediaId: input.media.id,
    index: input.index,
    type: input.media.type,
    variant: input.variant,
    url: input.url,
    path: input.path ?? '',
    attempts: input.attempts ?? 0,
  }
}

function skippedItem(
  base: MediaDownloadItemBase,
  reason: Extract<MediaDownloadItem, { status: 'skipped' }>['reason'],
  options: { duplicateOf?: string, bytes?: number } = {},
): MediaDownloadItem {
  return {
    ...base,
    status: 'skipped',
    reason,
    ...options,
  }
}

function failedItem(input: {
  base: MediaDownloadItemBase
  error: unknown
  attempts: number
}): Extract<MediaDownloadItem, { status: 'failed' }> {
  const error = input.error
  const weiboError = error instanceof WeiboSDKError ? error : undefined
  const status = weiboError?.context?.status
  return {
    ...input.base,
    status: 'failed',
    attempts: input.attempts,
    error,
    code: weiboError?.code ?? 'MEDIA_DOWNLOAD_FAILED',
    message: error instanceof Error ? error.message : String(error),
    retryable: weiboError?.retryable ?? false,
    httpStatus: typeof status === 'number' ? status : undefined,
  }
}

function httpStatusOf(error: unknown): number | undefined {
  if (!(error instanceof WeiboSDKError))
    return undefined
  const status = error.context?.status
  return typeof status === 'number' ? status : undefined
}

async function safeOnItemError(
  callback: MediaDownloadOptions['onItemError'],
  error: unknown,
  context: MediaItemErrorContext,
): Promise<void> {
  try {
    await callback?.(error, context)
  }
  catch {
    // 回调异常不掩盖原始错误
  }
}

async function planMedia(
  tweet: ITweet,
  options: ResolvedMediaOptions,
  store: MediaFileStore,
): Promise<PlanResult> {
  const effective = effectiveMedia(tweet)
  const skipped: PlanResult['skipped'] = []
  const tasks: PlannedTask[] = []
  const dryRunItems: PlanResult['dryRunItems'] = []
  const seenMedia = new Map<string, string>()
  const seenUrls = new Map<string, string>()
  const seenPaths = new Map<string, string>()
  let order = 0

  for (let mediaIndex = 0; mediaIndex < effective.media.length; mediaIndex += 1) {
    const media = effective.media[mediaIndex]
    const index = mediaIndex + 1
    const variants = variantsFor(media)

    if (!options.include.has(media.type)) {
      for (const variant of variants) {
        skipped.push({
          order: order++,
          item: skippedItem(baseItem({ media, index, variant: variant.variant, url: variant.url }), 'filtered-out'),
        })
      }
      continue
    }

    for (const variant of variants) {
      const base = baseItem({ media, index, variant: variant.variant, url: variant.url })

      if (!variant.url) {
        skipped.push({ order: order++, item: skippedItem(base, 'no-url') })
        continue
      }

      const mediaKey = `${media.id}:${variant.variant}`
      const duplicateMediaId = seenMedia.get(mediaKey)
      if (duplicateMediaId !== undefined) {
        skipped.push({
          order: order++,
          item: skippedItem(base, 'duplicate-id', { duplicateOf: duplicateMediaId }),
        })
        continue
      }
      seenMedia.set(mediaKey, media.id)

      const urlKey = variant.url.trim()
      const duplicateUrlId = seenUrls.get(urlKey)
      if (duplicateUrlId !== undefined) {
        skipped.push({
          order: order++,
          item: skippedItem(base, 'duplicate-url', { duplicateOf: duplicateUrlId }),
        })
        continue
      }
      seenUrls.set(urlKey, media.id)

      const ext = resolveExtension({ url: variant.url, type: media.type, variant: variant.variant })
      const path = store.resolve(options.dir, buildMediaFileName({
        mblogId: tweet.mblogId,
        index,
        mediaId: media.id,
        type: media.type,
        variant: variant.variant,
        ext,
      }))
      const pathKey = store.caseInsensitive ? path.toLowerCase() : path
      const duplicatePathId = seenPaths.get(pathKey)
      if (duplicatePathId !== undefined) {
        skipped.push({
          order: order++,
          item: skippedItem({ ...base, path }, 'duplicate-url', { duplicateOf: duplicatePathId }),
        })
        continue
      }
      seenPaths.set(pathKey, media.id)

      base.path = path

      if (!options.dryRun && !options.overwrite) {
        const stat = await store.stat(path)
        if (stat && stat.size > 0) {
          skipped.push({
            order: order++,
            item: skippedItem(base, 'exists', { bytes: stat.size }),
          })
          continue
        }
      }

      const currentOrder = order++
      if (options.dryRun) {
        dryRunItems.push({ order: currentOrder, item: { ...base, status: 'planned' } })
      }
      else {
        tasks.push({
          order: currentOrder,
          mblogId: tweet.mblogId,
          item: base,
          media,
          variant: variant.variant,
          source: effective.source,
        })
      }
    }
  }

  return { skipped, tasks, dryRunItems }
}

function findRefreshedUrl(tweet: ITweet, task: PlannedTask): string | undefined {
  const repostMedia = tweet.repostChain?.flatMap(entry => entry.media)
  const lists: TweetMedia[][] = []
  const preferred = task.source === 'retweeted'
    ? tweet.retweetedStatus?.media
    : task.source === 'repost'
      ? repostMedia
      : tweet.media
  if (preferred)
    lists.push(preferred)
  if (tweet.media)
    lists.push(tweet.media)
  if (repostMedia)
    lists.push(repostMedia)
  if (tweet.retweetedStatus?.media)
    lists.push(tweet.retweetedStatus.media)

  for (const list of lists) {
    const media = list.find(item => item.id === task.item.mediaId)
    if (!media)
      continue
    const url = task.variant === 'video' ? media.videoUrl : media.imageUrl
    if (url)
      return url
  }
  return undefined
}

/**
 * 单条微博的媒体下载编排器：规划 → 并发下载 → 重试 / 过期刷新 → 聚合。
 */
export class MediaDownloader {
  private refreshPromise?: Promise<ITweet>

  constructor(private readonly deps: MediaDownloaderDeps) {}

  async run(tweet: ITweet, options: ResolvedMediaOptions): Promise<MediaDownloaderResult> {
    if (options.signal?.aborted)
      throw createAbortError(options.signal)

    const clock = this.deps.clock ?? defaultClock
    const now = this.deps.now ?? (() => clock.now())
    const startedAt = now()
    const plan = await planMedia(tweet, options, this.deps.store)
    const total = plan.skipped.length + plan.tasks.length + plan.dryRunItems.length
    const counters: DownloadCounters = { downloaded: 0, skipped: 0, failed: 0, bytes: 0, completed: 0 }
    const ordered: Array<{ order: number, item: MediaDownloadItem }> = []

    const emit = async (order: number, item: MediaDownloadItem): Promise<void> => {
      ordered.push({ order, item })
      if (item.status === 'downloaded') {
        counters.downloaded += 1
        counters.bytes += item.bytes
      }
      else if (item.status === 'skipped') {
        counters.skipped += 1
      }
      else if (item.status === 'failed') {
        counters.failed += 1
      }
      counters.completed += 1

      try {
        await options.onProgress?.({
          mblogId: tweet.mblogId,
          completed: counters.completed,
          total,
          downloaded: counters.downloaded,
          skipped: counters.skipped,
          failed: counters.failed,
          bytes: counters.bytes,
          current: item,
        })
      }
      catch {
        // 进度回调异常不影响流
      }
    }

    for (const entry of plan.skipped)
      await emit(entry.order, entry.item)

    if (!options.dryRun) {
      const internalController = new AbortController()
      const signal = combineSignals(options.signal, internalController.signal)
      const semaphore = new MediaSemaphore(options.concurrency)
      let halted = false
      let fatalError: unknown

      const halt = (error?: unknown): void => {
        halted = true
        if (error !== undefined)
          fatalError = error
        internalController.abort(error)
      }

      const tasks = plan.tasks.map(async (task) => {
        await semaphore.run(async () => {
          if (halted || signal?.aborted) {
            await emit(task.order, skippedItem(task.item, 'aborted'))
            return
          }
          const item = await this.downloadOne(task, options, signal, halt, clock)
          await emit(task.order, item)
        })
      })

      await Promise.allSettled(tasks)

      if (fatalError !== undefined)
        throw fatalError
      if (options.signal?.aborted)
        throw createAbortError(options.signal)
    }
    else {
      for (const entry of plan.dryRunItems)
        await emit(entry.order, entry.item)
    }

    const items = ordered
      .sort((left, right) => left.order - right.order)
      .map(entry => entry.item)

    return {
      items,
      failures: items.filter((item): item is Extract<MediaDownloadItem, { status: 'failed' }> => item.status === 'failed'),
      totals: {
        total,
        downloaded: counters.downloaded,
        skipped: counters.skipped,
        failed: counters.failed,
        planned: Math.max(0, total - counters.downloaded - counters.skipped - counters.failed),
        bytes: counters.bytes,
      },
      durationMs: Math.max(0, now() - startedAt),
    }
  }

  private async downloadOne(
    task: PlannedTask,
    options: ResolvedMediaOptions,
    signal: AbortSignal | undefined,
    halt: (error?: unknown) => void,
    clock: IRateLimitClock,
  ): Promise<MediaDownloadItem> {
    const policy = buildMediaRetryPolicy(options.retries)
    const maxAttempts = policy.retries + 1
    let attempt = 0
    let refreshed = false
    let url = task.item.url
    let lastError: unknown

    while (attempt < maxAttempts) {
      if (signal?.aborted)
        throw createAbortError(signal)
      attempt += 1

      let response: MediaHttpResponse | undefined
      try {
        response = await this.deps.http.open({
          url,
          referer: options.referer,
          timeoutMs: options.timeoutMs,
          allowedHosts: options.allowedHosts,
          signal,
        })

        if (response.contentLength !== undefined && response.contentLength > options.maxBytes) {
          throw new MediaInvalidResponseError('Media file exceeds maxBytes before download.', {
            reason: 'too-large',
            contentLength: response.contentLength,
            maxBytes: options.maxBytes,
          })
        }

        const ext = resolveExtension({
          contentType: response.contentType,
          url: response.finalUrl,
          type: task.media.type,
          variant: task.variant,
        })
        const finalPath = this.deps.store.resolve(options.dir, buildMediaFileName({
          mblogId: task.mblogId,
          index: task.item.index,
          mediaId: task.item.mediaId,
          type: task.media.type,
          variant: task.variant,
          ext,
        }))

        if (finalPath !== task.item.path && !options.overwrite) {
          const stat = await this.deps.store.stat(finalPath)
          if (stat && stat.size > 0)
            return skippedItem({ ...task.item, path: finalPath, url, attempts: attempt }, 'exists', { bytes: stat.size })
        }

        const result = await persistStream(response.body, {
          store: this.deps.store,
          finalPath,
          overwrite: options.overwrite,
          maxBytes: options.maxBytes,
          idleTimeoutMs: options.idleTimeoutMs,
          expectedBytes: response.contentLength,
          signal,
          random: this.deps.random,
          timers: options.timers,
        })

        return {
          ...task.item,
          path: finalPath,
          url,
          attempts: attempt,
          status: 'downloaded',
          bytes: result.bytes,
          contentType: response.contentType,
          refreshed,
        }
      }
      catch (error) {
        lastError = error

        if (isAbortError(error, signal))
          throw error

        if (isStorageError(error)) {
          await safeOnItemError(options.onItemError, error, {
            mblogId: task.mblogId,
            mediaId: task.item.mediaId,
            index: task.item.index,
            type: task.item.type,
            variant: task.variant,
            url,
            attempts: attempt,
            fatal: true,
            httpStatus: httpStatusOf(error),
          })
          halt()
          return failedItem({ base: { ...task.item, url }, error, attempts: attempt })
        }

        if (isExpiredError(error) && options.refreshExpired && !refreshed) {
          const refresh = this.refreshOnce()
          if (!refresh)
            return this.fail(task, options, error, attempt, url, halt)
          refreshed = true
          try {
            const fresh = await refresh
            const nextUrl = findRefreshedUrl(fresh, task)
            if (nextUrl && nextUrl !== url) {
              url = nextUrl
              task.item.url = nextUrl
              continue
            }
          }
          catch (refreshError) {
            lastError = refreshError
            return this.fail(task, options, refreshError, attempt, url, halt)
          }
          return this.fail(task, options, error, attempt, url, halt)
        }

        const kind = classifyMediaError(error)
        if (kind && attempt < maxAttempts) {
          const delay = computeMediaBackoff({ attempt, policy, error, random: this.deps.random })
          await clock.sleep(delay)
          continue
        }

        return this.fail(task, options, error, attempt, url, halt)
      }
      finally {
        response?.dispose()
      }
    }

    return this.fail(task, options, lastError ?? new Error('Media download failed.'), attempt, url, halt)
  }

  private refreshOnce(): Promise<ITweet> | undefined {
    if (!this.deps.refresh)
      return undefined
    this.refreshPromise ??= this.deps.refresh()
    return this.refreshPromise
  }

  private async fail(
    task: PlannedTask,
    options: ResolvedMediaOptions,
    error: unknown,
    attempt: number,
    url: string,
    halt: (error?: unknown) => void,
  ): Promise<MediaDownloadItem> {
    const item = failedItem({ base: { ...task.item, url }, error, attempts: attempt })
    await safeOnItemError(options.onItemError, error, {
      mblogId: task.mblogId,
      mediaId: task.item.mediaId,
      index: task.item.index,
      type: task.item.type,
      variant: task.variant,
      url,
      attempts: attempt,
      fatal: false,
      httpStatus: item.httpStatus,
    })
    if (options.failFast)
      halt(error)
    return item
  }
}
