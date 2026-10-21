// 存档指定用户、指定时间范围内的微博，输出单个 JSON 文件。
//
// 枚举：把 [since, until] 按 --slice-days 拆成互不重叠的日期切片，每个切片独立调用
// sdk.archive.streamArchive({ timelineSource: 'search', since, until })；切片必须串行——
// searchProfile 的 page>1 复用会话里最近一次 page=1 的窗口，并发会互相覆盖并丢数据。
// 补全：每条微博重新走 statuses/show（含长文），再按需拉取全部一级评论 + 楼中楼；
// 多条微博按 --concurrency 全局窗口并发补全。
//
// 断点续传：每个切片独立写 <out>.slices/<sliceKey>.journal.jsonl（文件名唯一），
// <out>.slices/meta.json 记录 uid / 时间范围 / 切片计划 / 选项 / 用户信息；
// 每条 tweet / checkpoint 记录带 slice key，slice-done 表示该切片枚举完成。
// 进程中断后重跑同一命令会按切片续跑；参数不一致会拒绝，--fresh 丢弃重来。
// 最后把所有切片 journal 按 mblogId 去重（同 id 优先保留 issues 更少、更新的那一条），整理成单个 JSON。
// 归档 JSON 不含 raw（直接给下游用）；需要原始响应时用 --raw / --raw-out 单独写 JSONL。
//
// 用法：
//   pnpm archive:user <uid> --since 2025-01-01 --until 2025-12-31 --out ./weibo-archive.json
//   pnpm archive:user https://weibo.com/u/1234567890 --since 2025-01-01
//   pnpm archive:user 1234567890 --since 2025-01-01 --no-comments --reposts
//
// Cookie 只从 .env 读取（默认 <pwd>/.env），可用 --dotenv / --cookie 显式覆盖。
// 注意：pnpm 会拦截 Node 的 --env-file，所以通过 pnpm run 时请用 --dotenv。
// 退出码：0 = 完整；1 = 枚举中止或存在未能补全的微博（输出文件与 journal 都会保留）。

import type { ArchiveCheckpoint } from '../src/services/public/ArchiveService'
import type { ArchivedTweet, ArchiveFile, ArchiveIssue, ArchiveIssueStage } from '../src/types/archive/IArchiveFile'
import type { ITweet, ITweetComment } from '../src/types/domain/ITweet'
import type { IUser } from '../src/types/domain/IUser'
import type { WeiboSDKRawMeta } from '../src/types/hooks'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { WeiboSDKError } from '../src/models/errors/WeiboSDKError'
import { ARCHIVE_SCHEMA_ID, ARCHIVE_SCHEMA_URL } from '../src/types/archive/IArchiveFile'
import { resolveCookieInput } from '../src/utils/cookieInput'
import { readEnvValue } from '../src/utils/envFile'
import { resolveTimeInput } from '../src/utils/timeInput'
import { WeiboSDK } from '../src/WeiboSDK'

const WEIBO_EPOCH = '2009-08-14'
const JOURNAL_SCHEMA = 'weibo-user-archive-journal/v2'
const DEFAULT_CONCURRENCY = 6
const MAX_CONCURRENCY = 16
const DEFAULT_SLICE_DAYS = 30
const DEFAULT_DELAY_MS = 1000
const DEFAULT_BURST = 3
const MAX_BURST = 32
const DAY_SECONDS = 24 * 60 * 60
const FATAL_CODES = new Set(['AUTH_SESSION_EXPIRED', 'CONFIG_INVALID', 'RATE_LIMITED'])

interface RunOptions {
  includeComments: boolean
  includeReplies: boolean
  includeReposts: boolean
  commentOrder: 'time' | 'hot'
  maxComments?: number
  maxCommentPages?: number
  maxReplies?: number
  maxReplyPages?: number
  maxReposts?: number
  maxRepostPages?: number
}

interface RunConfig {
  uid: string
  range: {
    since: { input: string, unix: number }
    until: { input: string, unix: number }
  }
  /** 每 n 天拆一个独立枚举子任务；0 = 不拆分。 */
  sliceDays: number
  options: RunOptions
}

interface SliceDescriptor {
  index: number
  /** journal 中标识切片；由序号与区间组成，同一配置下稳定。 */
  key: string
  since: number
  until: number
}

interface JournalMeta {
  type: 'meta'
  schema: typeof JOURNAL_SCHEMA
  createdAt: string
  config: RunConfig
  slices: SliceDescriptor[]
  user: IUser
}

interface JournalTweetEntry {
  type: 'tweet'
  slice: string
  mblogId: string
  record: ArchivedTweet
  issues: ArchiveIssue[]
  checkpoint?: ArchiveCheckpoint
}

interface JournalCheckpointEntry {
  type: 'checkpoint'
  slice: string
  checkpoint: ArchiveCheckpoint
}

interface JournalSliceDoneEntry {
  type: 'slice-done'
  slice: string
}

interface JournalErrorEntry {
  type: 'error'
  slice?: string
  issue: ArchiveIssue
}

type JournalEntry = JournalMeta | JournalTweetEntry | JournalCheckpointEntry | JournalSliceDoneEntry | JournalErrorEntry

/** 切片 journal 里不会出现 meta（meta 单独放 <out>.slices/meta.json）。 */
type SliceJournalEntry = Exclude<JournalEntry, JournalMeta>

const HELP = `存档指定用户、指定时间范围内的微博详情（含评论区），输出单个 JSON 文件。

用法：
  pnpm archive:user <uid> [options]

时间范围（含边界，本地时区解析日期）：
  --since <date|unix>          起始：YYYY-MM-DD / YYYYMMDD / unix 秒（默认 ${WEIBO_EPOCH}）
  --until <date|unix>          结束：YYYY-MM-DD / YYYYMMDD / unix 秒（默认现在）

输出：
  -o, --out <path>             输出文件（默认 ./weibo-archive-<uid>.json）
  --force                      覆盖已存在的输出文件

原始响应（可选，单独存，不写入归档 JSON）：
  --raw                        把上游原始响应追加到 <out>.raw.ndjson
  --raw-out <path>             自定义 raw JSONL 路径（隐含 --raw）

内容：
  --no-comments                不拉评论区
  --no-replies                 只拉一级评论，不展开楼中楼
  --comment-order <time|hot>   评论排序（默认 time；time 序按数字 mid 翻页，完整遍历更稳）
  --max-comments <n>           每条微博最多一级评论数（默认不限）
  --max-comment-pages <n>      每条微博最多评论页数（默认不限）
  --max-replies <n>            每条一级评论最多楼中楼数（默认不限）
  --max-reply-pages <n>        每条一级评论最多楼中楼页数（默认不限）
  --reposts                    额外拉取每条微博的转发列表
  --max-reposts <n>            每条微博最多转发数（默认不限）
  --max-repost-pages <n>       每条微博最多转发页数（默认不限）

枚举与补全：
  --slice-days <n>             每 n 天拆一个独立枚举子任务（默认 ${DEFAULT_SLICE_DAYS}；0 = 不拆分）
  --concurrency <n>            全局同时补全的微博数（默认 ${DEFAULT_CONCURRENCY}，范围 1–${MAX_CONCURRENCY}）

  切片枚举始终串行：searchProfile 的 page>1 复用会话里最近一次 page=1 的窗口，
  并发切片会互相覆盖，导致每个切片只拿到第一页。

限速（默认约 1 req/s；调低 delay 会更快，也更容易触发 432）：
  --delay <ms>                 令牌补充间隔（默认 ${DEFAULT_DELAY_MS}ms）
  --burst <n>                  令牌桶容量 / 突发请求数（默认 ${DEFAULT_BURST}，上限 ${MAX_BURST}）

断点续传：
  每个切片独立 journal：<out>.slices/<sliceKey>.journal.jsonl，meta 在 <out>.slices/meta.json。
  重跑同一命令会按切片续跑，已完成的切片直接跳过。
  --fresh                      丢弃已有切片进度，从头开始

Cookie：
  --dotenv <path>              环境文件（默认 <pwd>/.env；pnpm 会拦截 --env-file，故用此名）
  --env-file <path>            同 --dotenv（仅直接跑 tsx / node 时可用）
  -c, --cookie <value>         Cookie header 串或 cookies.txt 路径（显式覆盖）

  -h, --help                   显示帮助

说明：
  - 只读；只使用 .env 中的 Cookie，不读取 shell 环境变量。
  - 每条微博都会重新拉取 statuses/show，长文会补拉全文。
  - 归档 JSON 不含 raw；--raw 走 SDK hooks.onRaw，记录当前进程发出的每次上游响应（可能很大）。
  - 中途中断不会丢已完成的微博；最终 JSON 按 mblogId 去重后写出。
  - 切片枚举串行；补全并发由 --concurrency 控制，实际 HTTP 速率仍受 SDK 令牌桶限制（默认约 1 req/s）。
  - 想真正提速时再调小 --delay / 调大 --burst；命中 432 会全局暂停并重试。
  - 退出码 0 表示完整；1 表示枚举中止或存在补全失败（输出文件仍会写入）。
  - 完整结束时 <out>.slices/ 会被删除；存在错误时保留，方便再次续跑。
`

function positiveInt(value: unknown, name: string): number | undefined {
  if (typeof value !== 'string' || value.trim() === '')
    return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`--${name} 需要非负整数，收到 ${JSON.stringify(value)}`)
  return parsed === 0 ? undefined : parsed
}

function resolveConcurrency(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '')
    return DEFAULT_CONCURRENCY
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`--concurrency 需要正整数，收到 ${JSON.stringify(value)}`)
  return Math.min(MAX_CONCURRENCY, parsed)
}

function resolveSliceDays(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '')
    return DEFAULT_SLICE_DAYS
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3660)
    throw new Error(`--slice-days 需要 0–3660 的整数，收到 ${JSON.stringify(value)}`)
  return parsed
}

function resolveDelay(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '')
    return DEFAULT_DELAY_MS
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`--delay 需要正整数毫秒，收到 ${JSON.stringify(value)}`)
  return parsed
}

function resolveBurst(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '')
    return DEFAULT_BURST
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`--burst 需要正整数，收到 ${JSON.stringify(value)}`)
  return Math.min(MAX_BURST, parsed)
}

/** 把 [since, until] 切成连续、无重叠、无空洞的固定窗口；0 表示不拆分。 */
function planSlices(since: number, until: number, sliceDays: number): SliceDescriptor[] {
  const chunk = sliceDays * DAY_SECONDS
  if (sliceDays <= 0 || until - since + 1 <= chunk)
    return [{ index: 0, key: `s000-${since}-${until}`, since, until }]

  const slices: SliceDescriptor[] = []
  for (let start = since; start <= until; start += chunk) {
    const end = Math.min(until, start + chunk - 1)
    const index = slices.length
    slices.push({
      index,
      key: `s${String(index).padStart(3, '0')}-${start}-${end}`,
      since: start,
      until: end,
    })
  }
  return slices
}

/** 简单信号量：限制跨切片的补全请求并发，避免「切片数 × 窗口」叠加放大。 */
function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: Array<() => void> = []

  const acquire = (): Promise<void> => new Promise<void>((resolve) => {
    if (active < limit) {
      active += 1
      resolve()
      return
    }
    waiting.push(() => {
      active += 1
      resolve()
    })
  })

  const release = (): void => {
    active -= 1
    waiting.shift()?.()
  }

  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire()
    try {
      return await task()
    }
    finally {
      release()
    }
  }
}

/** 固定 worker 数的任务池；单个任务抛错会结束该 worker，由调用方自行 catch。 */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!shouldStop()) {
      const index = next
      next += 1
      if (index >= items.length)
        return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

/** Cookie / 配置 / 持续限流错误继续跑其他切片没有意义，直接停止派发。 */
function isFatalError(error: unknown): boolean {
  return error instanceof WeiboSDKError && FATAL_CODES.has(error.code)
}

function normalizeUid(input: string): string {
  const value = input.trim()
  const fromUrl = value.match(/weibo\.(?:com|cn)\/(?:u\/)?(\d{5,})/i)?.[1]
  const uid = fromUrl ?? value
  if (!/^\d+$/.test(uid))
    throw new Error(`UID 必须是数字（也接受 https://weibo.com/u/<uid>），收到 ${JSON.stringify(input)}`)
  return uid
}

function toIssue(stage: ArchiveIssueStage, error: unknown, extra?: Omit<ArchiveIssue, 'stage' | 'code' | 'message'>): ArchiveIssue {
  if (error instanceof WeiboSDKError) {
    return {
      stage,
      code: error.code,
      level: error.level,
      retryable: error.retryable,
      message: error.message,
      ...extra,
      ...(error.context === undefined ? {} : { context: error.context }),
    }
  }
  return {
    stage,
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    ...extra,
  }
}

function parseCreatedAt(value: string): number | undefined {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

function withinRange(tweet: ITweet, since: number, until: number): boolean {
  const seconds = parseCreatedAt(tweet.createdAt)
  if (seconds === undefined)
    return true
  return seconds >= since && seconds <= until
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (item.id) {
      if (seen.has(item.id))
        continue
      seen.add(item.id)
    }
    out.push(item)
  }
  return out
}

function dedupeIssues(issues: ArchiveIssue[]): ArchiveIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = [issue.stage, issue.mblogId, issue.commentId, issue.code, issue.message].join('|')
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

let tempFileSeq = 0

function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  tempFileSeq += 1
  const tempPath = `${path}.${process.pid}.${tempFileSeq}.tmp`
  writeFileSync(tempPath, content, 'utf8')
  renameSync(tempPath, path)
}

function appendJournal(path: string, entry: SliceJournalEntry): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 旧 journal 可能带 raw；归档 JSON 不再包含 raw，读取时统一剥掉。 */
function stripRaw(record: ArchivedTweet): ArchivedTweet {
  if (!('raw' in record))
    return record
  const copy = { ...record }
  delete (copy as { raw?: unknown }).raw
  return copy
}

/** 读取并校验 <out>.slices/meta.json；缺失表示全新运行。 */
function readMeta(path: string): JournalMeta | undefined {
  if (!existsSync(path))
    return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  }
  catch {
    throw new Error(`meta 无法解析：${path}（加 --fresh 重新开始）`)
  }

  if (
    !isRecord(parsed)
    || parsed.schema !== JOURNAL_SCHEMA
    || !isRecord(parsed.config)
    || typeof parsed.config.sliceDays !== 'number'
    || !isRecord(parsed.user)
    || !Array.isArray(parsed.slices)
    || !parsed.slices.every(slice => isRecord(slice)
      && typeof slice.key === 'string'
      && typeof slice.since === 'number'
      && typeof slice.until === 'number')
  ) {
    throw new Error(`meta 不兼容：${path}（旧版归档进度请加 --fresh 重新开始）`)
  }
  return parsed as unknown as JournalMeta
}

interface LoadedSliceJournal {
  tweets: JournalTweetEntry[]
  errors: ArchiveIssue[]
  checkpoint?: ArchiveCheckpoint
  done: boolean
  repaired: boolean
}

/**
 * 读取单个切片的 journal；最后一行可能因进程被杀而截断，解析失败的行会被丢弃，
 * 并把修好的内容原子写回，避免后续 append 拼到半行后面。
 */
function readSliceJournal(path: string): LoadedSliceJournal {
  if (!existsSync(path))
    return { tweets: [], errors: [], done: false, repaired: false }

  const entries: SliceJournalEntry[] = []
  let repaired = false

  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line)
      continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    }
    catch {
      repaired = true
      continue
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      repaired = true
      continue
    }

    if (parsed.type === 'tweet') {
      if (
        typeof parsed.slice !== 'string'
        || typeof parsed.mblogId !== 'string'
        || !isRecord(parsed.record)
        || !Array.isArray(parsed.issues)
      ) {
        repaired = true
        continue
      }
      const entry = parsed as unknown as JournalTweetEntry
      entries.push({ ...entry, record: stripRaw(entry.record) })
      continue
    }
    if (parsed.type === 'checkpoint') {
      if (typeof parsed.slice !== 'string' || !isRecord(parsed.checkpoint)) {
        repaired = true
        continue
      }
      entries.push(parsed as unknown as JournalCheckpointEntry)
      continue
    }
    if (parsed.type === 'slice-done') {
      if (typeof parsed.slice !== 'string') {
        repaired = true
        continue
      }
      entries.push(parsed as unknown as JournalSliceDoneEntry)
      continue
    }
    if (parsed.type === 'error') {
      if (!isRecord(parsed.issue) || (parsed.slice !== undefined && typeof parsed.slice !== 'string')) {
        repaired = true
        continue
      }
      entries.push(parsed as unknown as JournalErrorEntry)
      continue
    }

    repaired = true
  }

  if (repaired)
    writeFileAtomic(path, entries.map(entry => `${JSON.stringify(entry)}\n`).join(''))

  const tweets = entries.filter((entry): entry is JournalTweetEntry => entry.type === 'tweet')
  const errors = entries
    .filter((entry): entry is JournalErrorEntry => entry.type === 'error')
    .map(entry => entry.issue)

  let checkpoint: ArchiveCheckpoint | undefined
  let done = false
  for (const entry of entries) {
    if (entry.type === 'tweet' && entry.checkpoint)
      checkpoint = entry.checkpoint
    else if (entry.type === 'checkpoint')
      checkpoint = entry.checkpoint
    else if (entry.type === 'slice-done')
      done = true
  }

  return { tweets, errors, checkpoint, done, repaired }
}

/** 同一个 mblogId 出现多次时，优先保留 issues 更少的一条；相同则保留更晚写入的。 */
function dedupeJournalTweets(tweets: JournalTweetEntry[]): JournalTweetEntry[] {
  const byId = new Map<string, JournalTweetEntry>()
  for (const entry of tweets) {
    const current = byId.get(entry.mblogId)
    if (!current || entry.issues.length <= current.issues.length)
      byId.set(entry.mblogId, entry)
  }
  return [...byId.values()]
}

/** 拉取一条微博的全部一级评论，并按需展开每条评论的楼中楼。 */
async function collectComments(
  sdk: WeiboSDK,
  tweet: ITweet,
  options: RunOptions,
  issues: ArchiveIssue[],
): Promise<ITweetComment[]> {
  if (!options.includeComments)
    return []

  const flow: 0 | 1 = options.commentOrder === 'hot' ? 0 : 1
  const comments: ITweetComment[] = []
  try {
    for await (const comment of sdk.tweets.streamComments(tweet.id, {
      flow,
      ...(options.maxComments === undefined ? {} : { maxItems: options.maxComments }),
      ...(options.maxCommentPages === undefined ? {} : { maxPages: options.maxCommentPages }),
    })) {
      comments.push(comment)
    }
  }
  catch (error) {
    issues.push(toIssue('comments', error, { mblogId: tweet.mblogId }))
  }

  if (!options.includeReplies)
    return comments

  for (const comment of comments) {
    const inline = comment.replies ?? []
    const expected = comment.totalReplies ?? 0
    // 没有楼中楼就不发请求；有内联预览但 total 缺失时也补拉一次。
    if (inline.length === 0 && expected <= 0)
      continue

    const fetched: ITweetComment[] = []
    try {
      for await (const reply of sdk.tweets.streamReplies(tweet.id, comment.id, {
        flow,
        ...(options.maxReplies === undefined ? {} : { maxItems: options.maxReplies }),
        ...(options.maxReplyPages === undefined ? {} : { maxPages: options.maxReplyPages }),
      })) {
        fetched.push(reply)
      }
    }
    catch (error) {
      issues.push(toIssue('replies', error, { mblogId: tweet.mblogId, commentId: comment.id }))
    }

    const merged = dedupeById([...inline, ...fetched])
    if (merged.length > 0)
      comment.replies = merged
  }

  return comments
}

/** 补全单条微博：详情 + 长文 + 评论区（+ 可选转发列表）。 */
async function archiveOne(
  sdk: WeiboSDK,
  base: ITweet,
  options: RunOptions,
): Promise<{ tweet: ArchivedTweet, issues: ArchiveIssue[] }> {
  const issues: ArchiveIssue[] = []
  const record: ArchivedTweet = {
    mblogId: base.mblogId,
    source: 'timeline',
    tweet: base,
    comments: [],
  }

  try {
    // statuses/show 默认带 isGetLongText=true，长微博全文已在 tweet.text。
    const detail = await sdk.tweets.enrich(base.mblogId)
    record.tweet = detail.tweet
  }
  catch (error) {
    issues.push(toIssue('detail', error, { mblogId: base.mblogId }))
  }

  record.comments = await collectComments(sdk, record.tweet, options, issues)

  if (options.includeReposts) {
    const reposts: ITweet[] = []
    try {
      for await (const repost of sdk.tweets.streamReposts(record.tweet.mblogId, {
        ...(options.maxReposts === undefined ? {} : { maxItems: options.maxReposts }),
        ...(options.maxRepostPages === undefined ? {} : { maxPages: options.maxRepostPages }),
      })) {
        reposts.push(repost)
      }
    }
    catch (error) {
      issues.push(toIssue('reposts', error, { mblogId: base.mblogId }))
    }
    record.reposts = reposts
  }

  return { tweet: record, issues }
}

function parseCommentOrder(value: unknown): 'time' | 'hot' {
  if (value === 'time' || value === 'hot')
    return value
  throw new Error(`--comment-order 只接受 time / hot，收到 ${JSON.stringify(value)}`)
}

function buildConfig(uid: string, values: Record<string, unknown>): RunConfig {
  const sinceInput = typeof values.since === 'string' && values.since.trim() !== ''
    ? values.since
    : WEIBO_EPOCH
  const untilInput = typeof values.until === 'string' && values.until.trim() !== ''
    ? values.until
    : String(Math.floor(Date.now() / 1000))
  const sinceUnix = resolveTimeInput(sinceInput, { boundary: 'start', field: 'since' })
  const untilUnix = resolveTimeInput(untilInput, { boundary: 'end', field: 'until' })
  if (sinceUnix > untilUnix)
    throw new Error(`--since（${sinceInput}）不能晚于 --until（${untilInput}）`)

  const commentOrder = parseCommentOrder(values['comment-order'])
  const options: RunOptions = {
    includeComments: values['no-comments'] !== true,
    includeReplies: values['no-replies'] !== true,
    includeReposts: values.reposts === true,
    commentOrder,
    maxComments: positiveInt(values['max-comments'], 'max-comments'),
    maxCommentPages: positiveInt(values['max-comment-pages'], 'max-comment-pages'),
    maxReplies: positiveInt(values['max-replies'], 'max-replies'),
    maxReplyPages: positiveInt(values['max-reply-pages'], 'max-reply-pages'),
    maxReposts: positiveInt(values['max-reposts'], 'max-reposts'),
    maxRepostPages: positiveInt(values['max-repost-pages'], 'max-repost-pages'),
  }

  return {
    uid,
    range: {
      since: { input: sinceInput, unix: sinceUnix },
      until: { input: untilInput, unix: untilUnix },
    },
    sliceDays: resolveSliceDays(values['slice-days']),
    options,
  }
}

function assertSameOption(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `--${name}=${JSON.stringify(actual)} 与断点日志不一致（已有 ${JSON.stringify(expected)}）。`
      + ' 去掉该参数继续，或加 --fresh 重新开始。',
    )
  }
}

/** 续跑时只允许省略参数（沿用 journal），显式传入的值必须与第一次一致。 */
function assertResumeConfig(
  config: RunConfig,
  uid: string,
  provided: Set<string>,
  values: Record<string, unknown>,
): void {
  if (config.uid !== uid)
    throw new Error(`journal 属于 uid ${config.uid}，当前是 ${uid}（加 --fresh 重新开始）`)

  if (provided.has('since')) {
    const since = resolveTimeInput(values.since as string, { boundary: 'start', field: 'since' })
    assertSameOption('since', since, config.range.since.unix)
  }
  if (provided.has('until')) {
    const until = resolveTimeInput(values.until as string, { boundary: 'end', field: 'until' })
    assertSameOption('until', until, config.range.until.unix)
  }
  if (provided.has('slice-days'))
    assertSameOption('slice-days', resolveSliceDays(values['slice-days']), config.sliceDays)
  if (provided.has('comment-order'))
    assertSameOption('comment-order', values['comment-order'], config.options.commentOrder)
  if (provided.has('no-comments') && config.options.includeComments)
    throw new Error('断点日志是包含评论的归档，不能再加 --no-comments（加 --fresh 重新开始）')
  if (provided.has('no-replies') && config.options.includeReplies)
    throw new Error('断点日志包含楼中楼，不能再加 --no-replies（加 --fresh 重新开始）')
  if (provided.has('reposts') && !config.options.includeReposts)
    throw new Error('断点日志没有归档转发，不能中途加 --reposts（加 --fresh 重新开始）')

  const maxOptions: Array<[string, number | undefined, number | undefined]> = [
    ['max-comments', positiveInt(values['max-comments'], 'max-comments'), config.options.maxComments],
    ['max-comment-pages', positiveInt(values['max-comment-pages'], 'max-comment-pages'), config.options.maxCommentPages],
    ['max-replies', positiveInt(values['max-replies'], 'max-replies'), config.options.maxReplies],
    ['max-reply-pages', positiveInt(values['max-reply-pages'], 'max-reply-pages'), config.options.maxReplyPages],
    ['max-reposts', positiveInt(values['max-reposts'], 'max-reposts'), config.options.maxReposts],
    ['max-repost-pages', positiveInt(values['max-repost-pages'], 'max-repost-pages'), config.options.maxRepostPages],
  ]
  for (const [name, actual, expected] of maxOptions) {
    if (provided.has(name))
      assertSameOption(name, actual, expected)
  }
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP)
    return
  }

  const { values, positionals, tokens } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    tokens: true,
    options: {
      'since': { type: 'string' },
      'until': { type: 'string' },
      'out': { type: 'string', short: 'o' },
      'dotenv': { type: 'string' },
      'env-file': { type: 'string' },
      'cookie': { type: 'string', short: 'c' },
      'force': { type: 'boolean', default: false },
      'fresh': { type: 'boolean', default: false },
      'raw': { type: 'boolean', default: false },
      'raw-out': { type: 'string' },
      'no-comments': { type: 'boolean', default: false },
      'no-replies': { type: 'boolean', default: false },
      'comment-order': { type: 'string', default: 'time' },
      'max-comments': { type: 'string' },
      'max-comment-pages': { type: 'string' },
      'max-replies': { type: 'string' },
      'max-reply-pages': { type: 'string' },
      'reposts': { type: 'boolean', default: false },
      'max-reposts': { type: 'string' },
      'max-repost-pages': { type: 'string' },
      'slice-days': { type: 'string' },
      'concurrency': { type: 'string' },
      'delay': { type: 'string' },
      'burst': { type: 'string' },
    },
  })

  const uidInput = positionals[0]
  if (!uidInput)
    throw new Error(`缺少 UID。\n\n${HELP}`)
  if (positionals.length > 1)
    throw new Error(`只接受一个 UID，收到多余参数：${positionals.slice(1).join(' ')}`)

  const uid = normalizeUid(uidInput)
  const provided = new Set<string>()
  for (const token of tokens) {
    if (token.kind === 'option')
      provided.add(token.name)
  }

  const outPath = resolve(
    process.cwd(),
    typeof values.out === 'string' && values.out.trim() !== '' ? values.out : `weibo-archive-${uid}.json`,
  )
  /** 切片进度目录：每个切片一个唯一命名的 journal，最后合并成单个归档 JSON。 */
  const partsDir = `${outPath}.slices`
  const metaPath = join(partsDir, 'meta.json')
  const legacyJournalPath = `${outPath}.journal.jsonl`
  const sliceJournalPath = (key: string): string => join(partsDir, `${key}.journal.jsonl`)

  if (values.fresh) {
    rmSync(partsDir, { recursive: true, force: true })
    rmSync(legacyJournalPath, { force: true })
  }

  const storedMeta = values.fresh ? undefined : readMeta(metaPath)

  let config: RunConfig
  if (storedMeta) {
    assertResumeConfig(storedMeta.config, uid, provided, values)
    config = storedMeta.config
    console.log(
      `[archive] resume parts=${partsDir} slices=${storedMeta.slices.length}`,
    )
  }
  else {
    if (!values.fresh && existsSync(legacyJournalPath)) {
      throw new Error(
        `检测到旧版单文件 journal：${legacyJournalPath}\n`
        + `切片进度现在按 ${partsDir}/<slice>.journal.jsonl 存放。加 --fresh 重新开始（旧进度不会自动迁移）。`,
      )
    }
    config = buildConfig(uid, values)
  }

  const { sinceUnix, untilUnix } = {
    sinceUnix: config.range.since.unix,
    untilUnix: config.range.until.unix,
  }
  const options = config.options
  const concurrency = resolveConcurrency(values.concurrency)
  const delay = resolveDelay(values.delay)
  const burst = resolveBurst(values.burst)
  const requestedConcurrency = typeof values.concurrency === 'string' ? Number(values.concurrency) : undefined
  if (requestedConcurrency !== undefined && requestedConcurrency > concurrency)
    console.log(`[archive] --concurrency ${requestedConcurrency} 超过上限 ${MAX_CONCURRENCY}，使用 ${concurrency}`)
  const slices = planSlices(sinceUnix, untilUnix, config.sliceDays)

  if (storedMeta) {
    const stored = storedMeta.slices
    const samePlan = stored.length === slices.length
      && stored.every((slice, index) => slice.key === slices[index].key)
    if (!samePlan)
      throw new Error(`切片计划与 ${metaPath} 不一致（加 --fresh 重新开始）`)
  }

  if (existsSync(outPath) && !values.force && storedMeta === undefined)
    throw new Error(`输出文件已存在：${outPath}（加 --force 覆盖，或保留切片进度续跑）`)

  const rawOutPath = (() => {
    if (typeof values['raw-out'] === 'string' && values['raw-out'].trim() !== '')
      return resolve(process.cwd(), values['raw-out'])
    if (values.raw)
      return `${outPath}.raw.ndjson`
    return undefined
  })()
  if (rawOutPath !== undefined) {
    if (
      rawOutPath === outPath
      || rawOutPath === legacyJournalPath
      || rawOutPath === metaPath
      || rawOutPath.startsWith(`${partsDir}${sep}`)
    ) {
      throw new Error('raw 路径不能与归档 JSON / 切片进度目录相同')
    }
    if (storedMeta === undefined) {
      if (existsSync(rawOutPath) && !values.force)
        throw new Error(`raw 文件已存在：${rawOutPath}（加 --force 覆盖）`)
      mkdirSync(dirname(rawOutPath), { recursive: true })
      writeFileSync(rawOutPath, '', 'utf8')
    }
    else {
      mkdirSync(dirname(rawOutPath), { recursive: true })
    }
  }

  let rawLineCount = 0
  let rawWriteError: string | undefined
  const rawTarget = rawOutPath
  const rawHooks = rawTarget === undefined
    ? undefined
    : {
        onRaw: (raw: unknown, meta: WeiboSDKRawMeta) => {
          try {
            appendFileSync(
              rawTarget,
              `${JSON.stringify({
                fetchedAt: new Date().toISOString(),
                timestamp: meta.timestamp,
                traceId: meta.trace_id,
                endpoint: meta.endpoint,
                resourceType: meta.resourceType,
                args: meta.args,
                raw,
              })}\n`,
              'utf8',
            )
            rawLineCount += 1
          }
          catch (error) {
            if (rawWriteError === undefined) {
              rawWriteError = error instanceof Error ? error.message : String(error)
              console.log(`[archive] raw write failed: ${rawWriteError}`)
            }
          }
        },
      }

  const envFileArg = typeof values.dotenv === 'string' && values.dotenv.trim() !== ''
    ? values.dotenv
    : typeof values['env-file'] === 'string' && values['env-file'].trim() !== ''
      ? values['env-file']
      : undefined
  const envFile = envFileArg === undefined
    ? join(process.cwd(), '.env')
    : resolve(process.cwd(), envFileArg)
  const rawCookie = (typeof values.cookie === 'string' && values.cookie.trim() !== '')
    ? values.cookie
    : readEnvValue(envFile, 'WEIBO_COOKIE') ?? ''

  let cookie: string
  try {
    cookie = resolveCookieInput(rawCookie)
  }
  catch (error) {
    throw new Error(`Cookie 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!cookie.trim())
    throw new Error(`未找到 WEIBO_COOKIE（读取 ${envFile}）。归档需要登录 Cookie；可用 --dotenv 或 --cookie 指定。`)

  const sdk = new WeiboSDK({
    auth: 'cookie',
    cookie,
    selfCheck: { mode: 'lazy' },
    delay,
    maxConcurrent: burst,
    ...(rawHooks === undefined ? {} : { hooks: rawHooks }),
  })

  console.log(`[archive] uid=${uid} since=${new Date(sinceUnix * 1000).toISOString()} until=${new Date(untilUnix * 1000).toISOString()}`)
  console.log(`[archive] out=${outPath}`)
  console.log(
    `[archive] slices=${slices.length} sliceDays=${config.sliceDays}`
    + ` concurrency=${concurrency}`
    + ` delay=${delay}ms burst=${burst}`,
  )
  if (rawOutPath !== undefined)
    console.log(`[archive] raw=${rawOutPath}`)

  let user: IUser
  if (storedMeta) {
    try {
      user = await sdk.users.getById(uid)
    }
    catch (error) {
      user = storedMeta.user
      console.log(`[archive] user refresh failed, using meta: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  else {
    user = await sdk.users.getById(uid)
    const meta: JournalMeta = {
      type: 'meta',
      schema: JOURNAL_SCHEMA,
      createdAt: new Date().toISOString(),
      config,
      slices,
      user,
    }
    writeFileAtomic(metaPath, `${JSON.stringify(meta, null, 2)}\n`)
    console.log(`[archive] parts=${partsDir}`)
  }
  console.log(`[archive] user=${user.name} (${user.id}) statuses=${user.stats.statuses}`)

  interface SliceState {
    descriptor: SliceDescriptor
    path: string
    checkpoint?: ArchiveCheckpoint
    done: boolean
    tweets: JournalTweetEntry[]
  }

  const sliceStates: SliceState[] = slices.map((descriptor) => {
    const path = sliceJournalPath(descriptor.key)
    const loaded = readSliceJournal(path)
    return {
      descriptor,
      path,
      checkpoint: loaded.checkpoint,
      done: loaded.done,
      tweets: loaded.tweets,
    }
  })

  /** 切片串行执行，单个切片的补全窗口可以直接用满全局并发。 */
  const perSliceWindow = concurrency

  const journalTweets: JournalTweetEntry[] = sliceStates.flatMap(state => state.tweets)
  const bestBefore = dedupeJournalTweets(journalTweets)
  const completed = new Set(bestBefore.filter(entry => entry.issues.length === 0).map(entry => entry.mblogId))
  const retryTargets = new Map<string, JournalTweetEntry>(
    bestBefore
      .filter(entry => entry.issues.length > 0)
      .map(entry => [entry.mblogId, entry] as const),
  )
  const attempted = new Set<string>()
  const enumIssues: ArchiveIssue[] = []
  let fatalError: unknown
  let processed = 0

  /** 补全请求的全局并发上限，不随切片数放大。 */
  const limitArchive = createLimiter(concurrency)

  interface PendingArchive {
    mblogId: string
    slice: string
    checkpoint?: ArchiveCheckpoint
    task: Promise<{ tweet: ArchivedTweet, issues: ArchiveIssue[], elapsedMs: number }>
  }

  /**
   * 按枚举顺序落盘一条补全结果。并发只发生在请求阶段，
   * 同一切片内 journal 追加顺序与 checkpoint 推进顺序保持和串行时一致，续跑语义不变。
   */
  const commitPending = async (pending: PendingArchive): Promise<void> => {
    const { tweet, issues, elapsedMs } = await pending.task
    const entry: JournalTweetEntry = {
      type: 'tweet',
      slice: pending.slice,
      mblogId: pending.mblogId,
      record: tweet,
      issues,
      ...(pending.checkpoint === undefined ? {} : { checkpoint: pending.checkpoint }),
    }
    journalTweets.push(entry)
    appendJournal(sliceJournalPath(pending.slice), entry)

    if (issues.length === 0) {
      completed.add(pending.mblogId)
      retryTargets.delete(pending.mblogId)
    }
    processed += 1

    const replyCount = tweet.comments.reduce((sum, comment) => sum + (comment.replies?.length ?? 0), 0)
    console.log(
      `[${processed}] ${pending.slice} ${tweet.mblogId} comments=${tweet.comments.length} replies=${replyCount}`
      + ` took=${(elapsedMs / 1000).toFixed(1)}s`
      + `${issues.length === 0 ? '' : ` errors=${issues.length}`}`,
    )
  }

  /** 单个切片的独立枚举 + 补全；checkpoint 只在该切片的 journal 记录里推进。 */
  const runSlice = async (state: SliceState): Promise<void> => {
    const { descriptor } = state
    if (state.done) {
      console.log(`[archive] slice ${descriptor.key} already done`)
      return
    }

    const persistCheckpoint = (checkpoint: ArchiveCheckpoint | undefined): void => {
      if (!checkpoint || checkpoint.uid !== uid)
        return
      state.checkpoint = checkpoint
      appendJournal(state.path, { type: 'checkpoint', slice: descriptor.key, checkpoint })
    }

    console.log(
      `[archive] slice ${descriptor.key} start since=${new Date(descriptor.since * 1000).toISOString()}`
      + ` until=${new Date(descriptor.until * 1000).toISOString()}`
      + `${state.checkpoint === undefined ? '' : ' resume'}`,
    )

    const pending: PendingArchive[] = []
    try {
      for await (const item of sdk.archive.streamArchive(uid, {
        timelineSource: 'search',
        since: descriptor.since,
        until: descriptor.until,
        // 固定为切片跨度，避免 SDK 的自适应窗口跨到相邻切片。
        ...(config.sliceDays <= 0 ? {} : { sliceWindow: descriptor.until - descriptor.since + 1 }),
        includeReposts: false,
        includeFavorites: false,
        includeComments: false,
        ...(state.checkpoint === undefined ? {} : { checkpoint: state.checkpoint }),
        onProgress: (progress) => {
          console.log(
            `[archive] slice=${descriptor.key} phase=${progress.phase} source=${progress.source ?? '-'} page=${progress.page ?? '-'} processed=${progress.processed}`,
          )
        },
        onItemError: (error, context) => {
          const stage: ArchiveIssueStage = context.stage === 'comments'
            ? 'comments'
            : context.stage === 'reposts' ? 'reposts' : 'timeline'
          const issue = toIssue(stage, error, {
            mblogId: context.mblogId ?? context.parentMblogId,
          })
          enumIssues.push(issue)
          appendJournal(state.path, { type: 'error', slice: descriptor.key, issue })
          console.log(
            `[archive] slice=${descriptor.key} error stage=${context.stage} source=${context.source} mblogId=${context.mblogId ?? '-'}: ${error instanceof Error ? error.message : String(error)}`,
          )
          // 枚举阶段失败默认中止当前切片，避免把缺页当成完整归档。
          return undefined
        },
      })) {
        if (item.source !== 'timeline' || !item.tweet || !item.mblogId)
          continue

        const tweet = item.tweet
        // 已完整处理过：只推进 checkpoint，不重复请求。
        if (completed.has(item.mblogId)) {
          persistCheckpoint(item.checkpoint)
          continue
        }
        if (attempted.has(item.mblogId))
          continue
        if (!withinRange(tweet, sinceUnix, untilUnix)) {
          persistCheckpoint(item.checkpoint)
          continue
        }

        attempted.add(item.mblogId)
        pending.push({
          mblogId: item.mblogId,
          slice: descriptor.key,
          ...(item.checkpoint === undefined ? {} : { checkpoint: item.checkpoint }),
          task: limitArchive(async () => {
            const startedAt = Date.now()
            console.log(`[start] ${descriptor.key} ${tweet.mblogId}`)
            const result = await archiveOne(sdk, tweet, options)
            return { ...result, elapsedMs: Date.now() - startedAt }
          }),
        })

        // 窗口满了就先落盘最早发起的一条，保证 journal / checkpoint 顺序与串行时一致。
        if (pending.length >= perSliceWindow)
          await commitPending(pending.shift()!)
      }
    }
    finally {
      // 枚举中止 / 提前退出时，窗口内已发出的补全仍要收尾落盘。
      while (pending.length > 0) {
        try {
          await commitPending(pending.shift()!)
        }
        catch (error) {
          fatalError ??= error
        }
      }
    }

    if (fatalError === undefined) {
      appendJournal(state.path, { type: 'slice-done', slice: descriptor.key })
      state.done = true
      console.log(`[archive] slice ${descriptor.key} done`)
    }
  }

  // searchProfile 的 page>1 复用会话里最近一次 page=1 的窗口，切片必须逐个枚举。
  for (const state of sliceStates) {
    if (fatalError !== undefined)
      break
    try {
      await runSlice(state)
    }
    catch (error) {
      // 认证 / 配置 / 持续限流继续跑其他切片没有意义，停止枚举。
      if (isFatalError(error)) {
        fatalError ??= error
        console.log(`[archive] slice ${state.descriptor.key} fatal: ${error instanceof Error ? error.message : String(error)}`)
        break
      }
      const issue = toIssue('timeline', error)
      enumIssues.push(issue)
      appendJournal(state.path, { type: 'error', slice: state.descriptor.key, issue })
      console.log(`[archive] slice ${state.descriptor.key} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 断点之前已经失败过的微博：本次枚举不一定会再遇到，补一轮重试。
  const retries = [...retryTargets.values()].filter(entry => !attempted.has(entry.mblogId))
  await runPool(retries, concurrency, async (entry) => {
    if (attempted.has(entry.mblogId))
      return
    attempted.add(entry.mblogId)
    const { tweet, issues } = await archiveOne(sdk, entry.record.tweet, options)
    const line: JournalTweetEntry = {
      type: 'tweet',
      slice: entry.slice,
      mblogId: entry.mblogId,
      record: tweet,
      issues,
    }
    journalTweets.push(line)
    appendJournal(sliceJournalPath(entry.slice), line)
    if (issues.length === 0) {
      completed.add(entry.mblogId)
      retryTargets.delete(entry.mblogId)
    }
    const replyCount = tweet.comments.reduce((sum, comment) => sum + (comment.replies?.length ?? 0), 0)
    console.log(
      `[retry] ${entry.slice} ${entry.mblogId} comments=${tweet.comments.length} replies=${replyCount}`
      + `${issues.length === 0 ? ' OK' : ` errors=${issues.length}`}`,
    )
  }, () => fatalError !== undefined)

  const bestAfter = dedupeJournalTweets(journalTweets)
  const tweets = bestAfter.map(entry => stripRaw(entry.record))
  const allErrors = dedupeIssues([
    ...enumIssues,
    ...(fatalError === undefined ? [] : [toIssue('timeline', fatalError)]),
    ...bestAfter.flatMap(entry => entry.issues),
  ])
  const complete = fatalError === undefined && allErrors.length === 0

  tweets.sort((a, b) => (parseCreatedAt(b.tweet.createdAt) ?? 0) - (parseCreatedAt(a.tweet.createdAt) ?? 0))

  const output: ArchiveFile = {
    $schema: ARCHIVE_SCHEMA_URL,
    schema: ARCHIVE_SCHEMA_ID,
    generatedAt: new Date().toISOString(),
    complete,
    query: {
      uid,
      range: {
        since: { ...config.range.since, iso: new Date(sinceUnix * 1000).toISOString() },
        until: { ...config.range.until, iso: new Date(untilUnix * 1000).toISOString() },
      },
      includeComments: options.includeComments,
      includeReplies: options.includeReplies,
      includeReposts: options.includeReposts,
      commentOrder: options.commentOrder,
    },
    user,
    stats: {
      tweets: tweets.length,
      comments: tweets.reduce((sum, tweet) => sum + tweet.comments.length, 0),
      replies: tweets.reduce(
        (sum, tweet) => sum + tweet.comments.reduce((inner, comment) => inner + (comment.replies?.length ?? 0), 0),
        0,
      ),
      errors: allErrors.length,
    },
    tweets,
    errors: allErrors,
  }

  writeFileAtomic(outPath, `${JSON.stringify(output, null, 2)}\n`)

  console.log(
    `[archive] done tweets=${output.stats.tweets} comments=${output.stats.comments} replies=${output.stats.replies} errors=${output.stats.errors}`,
  )
  console.log(`[archive] wrote ${outPath}`)
  if (rawOutPath !== undefined) {
    if (rawWriteError !== undefined)
      console.log(`[archive] raw incomplete: ${rawOutPath} lines=${rawLineCount}: ${rawWriteError}`)
    else
      console.log(`[archive] raw=${rawOutPath} lines=${rawLineCount}`)
  }

  if (complete) {
    rmSync(partsDir, { recursive: true, force: true })
    console.log(`[archive] parts removed`)
  }
  else {
    console.log(`[archive] parts kept for resume: ${partsDir}`)
  }

  if (fatalError !== undefined)
    throw fatalError
  if (allErrors.length > 0 || rawWriteError !== undefined)
    process.exitCode = 1
}

run().catch((error) => {
  console.log(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
