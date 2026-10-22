import type { UserArchiveOptions } from '~/types/archive/IUserArchive'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { MAX_USER_ARCHIVE_CONCURRENCY } from '~/services/public/userArchive/config'
import { createRawRecorder, prepareRawPath } from '../archiveUser/raw'
import { FileUserArchiveStore, writeFileAtomic } from '../archiveUser/store'
import { parsePositiveInt } from '../parseArgs'
import { createSDK } from '../shared'

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

/** CLI 参数 → SDK 选项。 */
export function userArchiveOptionsFromArgs(args: Record<string, unknown>): UserArchiveOptions {
  const commentOrder = args['comment-order']
  if (commentOrder !== undefined && commentOrder !== 'time' && commentOrder !== 'hot') {
    throw new InvalidConfigError(`Invalid --comment-order: ${JSON.stringify(commentOrder)}. Expected "time" or "hot".`, {
      field: 'comment-order',
      value: commentOrder,
    })
  }

  return {
    ...(typeof args.since === 'string' && args.since.trim() !== '' ? { since: args.since } : {}),
    ...(typeof args.until === 'string' && args.until.trim() !== '' ? { until: args.until } : {}),
    ...(parseNonNegativeInt(args['slice-days'], 'slice-days') === undefined
      ? {}
      : { sliceDays: parseNonNegativeInt(args['slice-days'], 'slice-days') }),
    includeComments: args.comments !== false,
    includeReplies: args.replies !== false,
    includeReposts: args.reposts === true,
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

  if (args.fresh === true)
    await store.clear()

  const resuming = (await store.loadMeta()) !== undefined
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

  const sdkArgs = {
    ...args,
    ...(args['env-file'] === undefined && typeof args.dotenv === 'string' ? { 'env-file': args.dotenv } : {}),
  }
  const delay = parsePositiveInt(args.delay)
  const burst = parsePositiveInt(args.burst)
  const requestedConcurrency = parsePositiveInt(args.concurrency)
  if (requestedConcurrency !== undefined && requestedConcurrency > MAX_USER_ARCHIVE_CONCURRENCY) {
    process.stderr.write(
      `${JSON.stringify({ event: 'notice', message: `--concurrency ${requestedConcurrency} 超过上限 ${MAX_USER_ARCHIVE_CONCURRENCY}，使用 ${MAX_USER_ARCHIVE_CONCURRENCY}` })}\n`,
    )
  }

  const sdk = createSDK(sdkArgs, {
    ...(delay === undefined ? {} : { delay }),
    ...(burst === undefined ? {} : { maxConcurrent: burst }),
    ...(rawRecorder.hooks === undefined ? {} : { hooks: rawRecorder.hooks }),
  })

  const result = await sdk.userArchive.run(uid, {
    ...userArchiveOptionsFromArgs(args),
    store,
    onProgress: (progress) => {
      process.stderr.write(`${JSON.stringify({ event: 'progress', ...progress })}\n`)
    },
    onIssue: (issue) => {
      process.stderr.write(`${JSON.stringify({ event: 'issue', ...issue })}\n`)
    },
  })

  writeFileAtomic(outPath, `${JSON.stringify(result.file, null, 2)}\n`)

  if (result.complete)
    await store.clear()
  else
    process.stderr.write(`${JSON.stringify({ event: 'parts-kept', path: store.paths.partsDir })}\n`)

  if (rawOutPath !== undefined) {
    process.stderr.write(`${JSON.stringify({
      event: 'raw',
      path: rawOutPath,
      lines: rawRecorder.lines,
      ...(rawRecorder.error === undefined ? {} : { error: rawRecorder.error }),
    })}\n`)
  }

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
