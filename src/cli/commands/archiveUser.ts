import type { UserArchiveOptions } from '~/types/archive/IUserArchive'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { MAX_USER_ARCHIVE_CONCURRENCY } from '~/services/public/userArchive/config'
import { createRawRecorder, prepareRawPath } from '../archiveUser/raw'
import { FileUserArchiveStore, writeFileAtomic } from '../archiveUser/store'
import { parsePositiveInt } from '../parseArgs'
import { createSDK } from '../shared'
import { isInteractiveOutput, resolveLogFormat, supportsColor } from '../terminal/format'
import { createArchiveReporter } from '../terminal/reporter'

/** 接受数字 uid 或微博主页链接。 */
export function normalizeArchiveUid(input: string): string {
  const value = input.trim()
  const fromUrl = value.match(/weibo\.(?:com|cn)\/(?:u\/)?(\d{5,})/i)?.[1]
  const uid = fromUrl ?? value
  if (!/^\d+$/.test(uid)) {
    throw new InvalidConfigError(`Invalid uid: ${JSON.stringify(input)}. Expected digits or https://weibo.com/u/<uid>.`, {
      field: 'uid',
      value: input,
    })
  }
  return uid
}

function parseNonNegativeInt(value: unknown, field: string): number | undefined {
  if (typeof value !== 'string' || value.trim() === '')
    return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidConfigError(`Invalid ${field}: ${JSON.stringify(value)}. Expected a non-negative integer.`, {
      field,
      value,
    })
  }
  return parsed
}

/** 原始 argv 里是否显式出现某个 flag；没有 `__rawArgs` 时返回 undefined。 */
function rawFlagPresent(args: Record<string, unknown>, flag: string): boolean | undefined {
  const raw = args.__rawArgs
  if (!Array.isArray(raw))
    return undefined
  return raw.some(item => typeof item === 'string' && (item === flag || item.startsWith(`${flag}=`)))
}

/** CLI 参数 → SDK 选项。 */
export function userArchiveOptionsFromArgs(args: Record<string, unknown>): UserArchiveOptions {
  const hasRawArgs = Array.isArray(args.__rawArgs)
  const commentOrderValue = typeof args['comment-order'] === 'string' ? args['comment-order'] : undefined
  const commentOrder = hasRawArgs
    ? (rawFlagPresent(args, '--comment-order') === true ? commentOrderValue : undefined)
    : commentOrderValue
  if (commentOrder !== undefined && commentOrder !== 'time' && commentOrder !== 'hot') {
    throw new InvalidConfigError(`Invalid --comment-order: ${JSON.stringify(commentOrder)}. Expected "time" or "hot".`, {
      field: 'comment-order',
      value: commentOrder,
    })
  }

  const includeComments = args.comments === false
    ? false
    : hasRawArgs
      ? (rawFlagPresent(args, '--no-comments') === true ? false : rawFlagPresent(args, '--comments') === true ? true : undefined)
      : true
  const includeReplies = args.replies === false
    ? false
    : hasRawArgs
      ? (rawFlagPresent(args, '--no-replies') === true ? false : rawFlagPresent(args, '--replies') === true ? true : undefined)
      : true
  const includeReposts = rawFlagPresent(args, '--reposts') === true
    ? true
    : hasRawArgs
      ? undefined
      : args.reposts === true

  const sliceDays = parseNonNegativeInt(args['slice-days'], 'slice-days')

  return {
    ...(typeof args.since === 'string' && args.since.trim() !== '' ? { since: args.since } : {}),
    ...(typeof args.until === 'string' && args.until.trim() !== '' ? { until: args.until } : {}),
    ...(sliceDays === undefined ? {} : { sliceDays }),
    includeComments,
    includeReplies,
    ...(includeReposts === undefined ? {} : { includeReposts }),
    ...(commentOrder === undefined ? {} : { commentOrder }),
    maxComments: parsePositiveInt(args['max-comments']),
    maxCommentPages: parsePositiveInt(args['max-comment-pages']),
    maxReplies: parsePositiveInt(args['max-replies']),
    maxReplyPages: parsePositiveInt(args['max-reply-pages']),
    maxReposts: parsePositiveInt(args['max-reposts']),
    maxRepostPages: parsePositiveInt(args['max-repost-pages']),
    concurrency: parsePositiveInt(args.concurrency),
  }
}

export interface RunArchiveUserResult {
  outPath: string
  complete: boolean
  summary: {
    tweets: number
    comments: number
    replies: number
    errors: number
  }
}

/**
 * 执行 `archive user` 的实际流程，供 citty 命令与测试复用。
 */
export async function runArchiveUser(
  args: Record<string, unknown>,
  cwd: string = process.cwd(),
): Promise<RunArchiveUserResult> {
  const uid = normalizeArchiveUid(String(args.uid ?? ''))
  const outPath = resolve(
    cwd,
    typeof args.out === 'string' && args.out.trim() !== '' ? args.out : `weibo-archive-${uid}.json`,
  )
  const store = new FileUserArchiveStore(outPath)

  const logContext = { env: process.env, isTTY: process.stderr.isTTY === true }
  const format = resolveLogFormat(args, logContext)
  const noProgress = args['no-progress'] === true

  if (args.fresh === true)
    await store.clear()

  const storedMeta = await store.loadMeta()
  const resuming = storedMeta !== undefined
  if (!resuming) {
    if (existsSync(outPath) && args.force !== true)
      throw new Error(`输出文件已存在：${outPath}（加 --force 覆盖，或保留切片进度续跑）`)
    if (existsSync(store.paths.legacyJournalPath)) {
      throw new Error(
        `检测到旧版单文件 journal：${store.paths.legacyJournalPath}\n`
        + `切片进度现在按 ${store.paths.partsDir}/<slice>.journal.jsonl 存放。加 --fresh 重新开始（旧进度不会自动迁移）。`,
      )
    }
  }

  const rawOutPath = prepareRawPath({
    cwd,
    rawOut: typeof args['raw-out'] === 'string' ? args['raw-out'] : undefined,
    raw: args.raw === true,
    paths: store.paths,
    force: args.force === true,
    resuming,
  })
  const rawRecorder = createRawRecorder(rawOutPath)

  const reporter = createArchiveReporter({
    format,
    stream: process.stderr,
    interactive: isInteractiveOutput(format, { ...logContext, noProgress }),
    color: supportsColor(logContext),
    noProgress,
  })
  const sinceLabel = typeof args.since === 'string' && args.since.trim() !== ''
    ? args.since
    : storedMeta?.config.range.since.input ?? '2009-08-14'
  const untilLabel = typeof args.until === 'string' && args.until.trim() !== ''
    ? args.until
    : storedMeta?.config.range.until.input ?? '现在'
  const range = `${sinceLabel} → ${untilLabel}`
  const startedAt = Date.now()

  try {
    reporter.start({ uid, outPath, range })

    const sdkArgs = {
      ...args,
      ...(args['env-file'] === undefined && typeof args.dotenv === 'string' ? { 'env-file': args.dotenv } : {}),
    }
    const delay = parsePositiveInt(args.delay)
    const burst = parsePositiveInt(args.burst)
    const requestedConcurrency = parsePositiveInt(args.concurrency)
    if (requestedConcurrency !== undefined && requestedConcurrency > MAX_USER_ARCHIVE_CONCURRENCY) {
      reporter.notice(`--concurrency ${requestedConcurrency} 超过上限 ${MAX_USER_ARCHIVE_CONCURRENCY}，使用 ${MAX_USER_ARCHIVE_CONCURRENCY}`)
    }

    const sdk = createSDK(sdkArgs, {
      ...(delay === undefined ? {} : { delay }),
      ...(burst === undefined ? {} : { maxConcurrent: burst }),
      ...(rawRecorder.hooks === undefined ? {} : { hooks: rawRecorder.hooks }),
    })

    const result = await sdk.userArchive.run(uid, {
      ...userArchiveOptionsFromArgs(args),
      store,
      onProgress: progress => reporter.progress(progress),
      onIssue: issue => reporter.issue(issue),
      onRecord: entry => reporter.record(entry),
    })

    writeFileAtomic(outPath, `${JSON.stringify(result.file, null, 2)}\n`)

    if (result.complete)
      await store.clear()
    else
      reporter.partsKept(store.paths.partsDir)

    if (rawOutPath !== undefined) {
      reporter.rawSummary({
        path: rawOutPath,
        lines: rawRecorder.lines,
        ...(rawRecorder.error === undefined ? {} : { error: rawRecorder.error }),
      })
    }

    reporter.finish({
      outPath,
      complete: result.complete,
      summary: result.summary,
      elapsedMs: Date.now() - startedAt,
    })

    console.log(JSON.stringify({
      event: 'done',
      out: outPath,
      uid,
      tweets: result.summary.tweets,
      comments: result.summary.comments,
      replies: result.summary.replies,
      errors: result.summary.errors,
      complete: result.complete,
    }))

    if (!result.complete || rawRecorder.error !== undefined)
      process.exitCode = 1

    return {
      outPath,
      complete: result.complete,
      summary: result.summary,
    }
  }
  finally {
    reporter.close()
  }
}
