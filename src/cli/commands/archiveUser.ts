import type { UserArchiveOptions } from '~/types/archive/IUserArchive'
import type { WeiboSDKTelemetry } from '~/types/telemetry'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { MAX_USER_ARCHIVE_CONCURRENCY } from '~/services/public/userArchive/config'
import { mergeArchiveFiles } from '~/services/public/userArchive/merge'
import { createRawRecorder, prepareRawPath } from '../archiveUser/raw'
import { FileUserArchiveStore, writeFileAtomic } from '../archiveUser/store'
import { parsePositiveInt } from '../parseArgs'
import { createSDK } from '../shared'
import { isInteractiveOutput, resolveLogFormat, supportsColor } from '../terminal/format'
import { createArchiveReporter } from '../terminal/reporter'
import { readArchiveFile } from './archiveMerge'

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
  const commentPages = parseNonNegativeInt(args['max-comment-pages'], 'max-comment-pages')
    ?? (args['all-comments'] === true ? 0 : undefined)
  const replyPages = parseNonNegativeInt(args['max-reply-pages'], 'max-reply-pages')
    ?? (args['all-replies'] === true ? 0 : undefined)

  return {
    ...(typeof args.since === 'string' && args.since.trim() !== '' ? { since: args.since } : {}),
    ...(typeof args.until === 'string' && args.until.trim() !== '' ? { until: args.until } : {}),
    ...(sliceDays === undefined ? {} : { sliceDays }),
    includeComments,
    includeReplies,
    ...(includeReposts === undefined ? {} : { includeReposts }),
    ...(commentOrder === undefined ? {} : { commentOrder }),
    maxComments: parsePositiveInt(args['max-comments']),
    ...(commentPages === undefined ? {} : { maxCommentPages: commentPages }),
    maxReplies: parsePositiveInt(args['max-replies']),
    ...(replyPages === undefined ? {} : { maxReplyPages: replyPages }),
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

const CLI_CONCURRENCY = 20
const CLI_DELAY_MS = 300
const CLI_BURST = 8
const FAST_CONCURRENCY = 32
const FAST_DELAY_MS = 100
const FAST_BURST = 16

export interface CliTuning {
  fast: boolean
  concurrency: number
  delayMs: number
  burst: number
}

/** `--fast` 预设；显式 `--concurrency` / `--delay` / `--burst` 仍然优先。 */
export function resolveCliTuning(args: Record<string, unknown>): CliTuning {
  const fast = args.fast === true
  return {
    fast,
    concurrency: parsePositiveInt(args.concurrency) ?? (fast ? FAST_CONCURRENCY : CLI_CONCURRENCY),
    delayMs: parsePositiveInt(args.delay) ?? (fast ? FAST_DELAY_MS : CLI_DELAY_MS),
    burst: parsePositiveInt(args.burst) ?? (fast ? FAST_BURST : CLI_BURST),
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
  const loadedRecords = resuming ? (await store.loadRecords()).length : 0
  const merge = args.merge === true
  if (!resuming) {
    if (existsSync(outPath) && args.force !== true && !merge)
      throw new Error(`输出文件已存在：${outPath}（加 --force 覆盖，或加 --merge 合并到已有归档）`)
    if (existsSync(store.paths.legacyJournalPath)) {
      throw new Error(
        `检测到旧版单文件 journal：${store.paths.legacyJournalPath}\n`
        + `切片进度现在按 ${store.paths.partsDir}/<slice>.journal.jsonl 存放。加 --fresh 重新开始（旧进度不会自动迁移）。`,
      )
    }
  }

  const baseline = merge && existsSync(outPath) ? readArchiveFile(outPath) : undefined
  if (baseline) {
    // 在真正抓取前校验基线：跨账号 / 非 v2 归档直接失败。
    mergeArchiveFiles([baseline])
    if (baseline.query?.uid !== uid) {
      throw new InvalidConfigError(
        `Cannot merge into ${outPath}: archive belongs to uid ${baseline.query?.uid}, got ${uid}.`,
        { field: 'merge', value: outPath },
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
    reporter.start({
      uid,
      outPath,
      range,
      ...(resuming ? { resumed: true, loadedRecords } : {}),
    })

    const sdkArgs = {
      ...args,
      ...(args['env-file'] === undefined && typeof args.dotenv === 'string' ? { 'env-file': args.dotenv } : {}),
    }
    const tuning = resolveCliTuning(args)
    const { delayMs: delay, burst, concurrency } = tuning
    const requestedConcurrency = parsePositiveInt(args.concurrency)
    if (requestedConcurrency !== undefined && requestedConcurrency > MAX_USER_ARCHIVE_CONCURRENCY) {
      reporter.notice(`--concurrency ${requestedConcurrency} 超过上限 ${MAX_USER_ARCHIVE_CONCURRENCY}，使用 ${MAX_USER_ARCHIVE_CONCURRENCY}`)
    }
    if (tuning.fast)
      reporter.notice(`fast preset: concurrency=${concurrency} delay=${delay}ms burst=${burst}`)

    const telemetry: WeiboSDKTelemetry = {
      emit: (event) => {
        if (event.event_name === 'rate_limit_wait' && event.reason === 'rate_limited')
          reporter.notice(`rate limited: wait ${Math.ceil((event.wait_ms ?? 0) / 1000)}s`)
      },
    }

    const sdk = createSDK(sdkArgs, {
      delay,
      burst,
      telemetry,
      ...(rawRecorder.hooks === undefined ? {} : { hooks: rawRecorder.hooks }),
    })

    const result = await sdk.userArchive.run(uid, {
      ...userArchiveOptionsFromArgs(args),
      concurrency,
      store,
      onProgress: progress => reporter.progress(progress),
      onIssue: (issue, slice) => reporter.issue(issue, slice),
      onRecord: entry => reporter.record(entry),
    })

    const merged = baseline === undefined ? undefined : mergeArchiveFiles([baseline, result.file])
    const file = merged?.file ?? result.file
    const summary = merged === undefined
      ? result.summary
      : {
          ...result.summary,
          tweets: file.stats.tweets,
          comments: file.stats.comments,
          replies: file.stats.replies,
          errors: file.stats.errors,
          complete: file.complete,
        }

    writeFileAtomic(outPath, `${JSON.stringify(file, null, 2)}\n`)

    if (result.complete)
      await store.clear()
    else
      reporter.partsKept(store.paths.partsDir)

    if (merged !== undefined) {
      reporter.notice(
        `合并已有归档：${baseline?.tweets.length ?? 0} + ${result.file.tweets.length} 条`
        + ` → ${file.tweets.length} 条（去重 ${merged.deduped}）`,
      )
    }

    if (rawOutPath !== undefined) {
      reporter.rawSummary({
        path: rawOutPath,
        lines: rawRecorder.lines,
        ...(rawRecorder.error === undefined ? {} : { error: rawRecorder.error }),
      })
    }

    reporter.finish({
      outPath,
      complete: file.complete,
      summary,
      elapsedMs: Date.now() - startedAt,
    })

    console.log(JSON.stringify({
      event: 'done',
      out: outPath,
      uid,
      tweets: file.stats.tweets,
      comments: file.stats.comments,
      replies: file.stats.replies,
      errors: file.stats.errors,
      complete: file.complete,
      ...(merged === undefined ? {} : { merged: true, deduped: merged.deduped }),
      ...(result.summary.estimatedTotal === undefined ? {} : { estimatedTotal: result.summary.estimatedTotal }),
      ...(result.summary.coverage === undefined ? {} : { coverage: result.summary.coverage }),
    }))

    if (!file.complete || rawRecorder.error !== undefined)
      process.exitCode = 1

    return {
      outPath,
      complete: file.complete,
      summary,
    }
  }
  finally {
    reporter.close()
  }
}
