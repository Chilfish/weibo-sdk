// 存档指定用户、指定时间范围内的微博，输出单个 JSON 文件。
//
// 枚举：sdk.archive.streamArchive({ timelineSource: 'search', since, until }) 按日期切片遍历；
// 补全：每条微博重新走 statuses/show（含长文），再按需拉取全部一级评论 + 楼中楼。
//
// 断点续传：每完成一条微博就追加一行 JSONL（<out>.journal.jsonl），第一行是 meta
// （uid / 时间范围 / 选项 / 用户信息），后续行带 record、issues 和 archive checkpoint。
// 进程中断后重跑同一命令会自动从 journal 续跑；参数不一致会拒绝，--fresh 丢弃重来。
// 最后按 mblogId 去重（同 id 优先保留 issues 更少、更新的那一条），整理成单个 JSON。
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
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { WeiboSDKError } from '../src/models/errors/WeiboSDKError'
import { ARCHIVE_SCHEMA_ID, ARCHIVE_SCHEMA_URL } from '../src/types/archive/IArchiveFile'
import { resolveCookieInput } from '../src/utils/cookieInput'
import { readEnvValue } from '../src/utils/envFile'
import { resolveTimeInput } from '../src/utils/timeInput'
import { WeiboSDK } from '../src/WeiboSDK'

const WEIBO_EPOCH = '2009-08-14'
const JOURNAL_SCHEMA = 'weibo-user-archive-journal/v1'

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
  options: RunOptions
}

interface JournalMeta {
  type: 'meta'
  schema: typeof JOURNAL_SCHEMA
  createdAt: string
  config: RunConfig
  user: IUser
}

interface JournalTweetEntry {
  type: 'tweet'
  mblogId: string
  record: ArchivedTweet
  issues: ArchiveIssue[]
  checkpoint?: ArchiveCheckpoint
}

interface JournalCheckpointEntry {
  type: 'checkpoint'
  checkpoint: ArchiveCheckpoint
}

interface JournalErrorEntry {
  type: 'error'
  issue: ArchiveIssue
}

type JournalEntry = JournalMeta | JournalTweetEntry | JournalCheckpointEntry | JournalErrorEntry

interface LoadedJournal {
  meta: JournalMeta
  tweets: JournalTweetEntry[]
  errors: ArchiveIssue[]
  lastCheckpoint?: ArchiveCheckpoint
  repaired: boolean
}

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

断点续传：
  每完成一条微博会追加到 <out>.journal.jsonl；重跑同一命令会自动续跑。
  --fresh                      丢弃已有 journal，从头开始

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
  - 退出码 0 表示完整；1 表示枚举中止或存在补全失败（输出文件仍会写入）。
  - 完整结束时 journal 会被删除；存在错误时保留，方便再次续跑。
`

function positiveInt(value: unknown, name: string): number | undefined {
  if (typeof value !== 'string' || value.trim() === '')
    return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`--${name} 需要非负整数，收到 ${JSON.stringify(value)}`)
  return parsed === 0 ? undefined : parsed
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

function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.tmp`
  writeFileSync(tempPath, content, 'utf8')
  renameSync(tempPath, path)
}

function appendJournal(path: string, entry: JournalEntry): void {
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

/**
 * 读取并校验 journal；最后一行可能因进程被杀而截断，解析失败的行会被丢弃，
 * 并把修好的内容原子写回，避免后续 append 拼到半行后面。
 */
function readJournal(path: string): LoadedJournal | undefined {
  if (!existsSync(path))
    return undefined

  const content = readFileSync(path, 'utf8')
  const entries: JournalEntry[] = []
  let repaired = false

  for (const rawLine of content.split('\n')) {
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

    if (parsed.type === 'meta') {
      if (parsed.schema !== JOURNAL_SCHEMA || !isRecord(parsed.config) || !isRecord(parsed.user))
        throw new Error(`journal 的 meta 不兼容：${path}（加 --fresh 重新开始）`)
      entries.push(parsed as unknown as JournalMeta)
      continue
    }
    if (parsed.type === 'tweet') {
      if (typeof parsed.mblogId !== 'string' || !isRecord(parsed.record) || !Array.isArray(parsed.issues)) {
        repaired = true
        continue
      }
      const entry = parsed as unknown as JournalTweetEntry
      entries.push({ ...entry, record: stripRaw(entry.record) })
      continue
    }
    if (parsed.type === 'checkpoint') {
      if (!isRecord(parsed.checkpoint)) {
        repaired = true
        continue
      }
      entries.push(parsed as unknown as JournalCheckpointEntry)
      continue
    }
    if (parsed.type === 'error') {
      if (!isRecord(parsed.issue)) {
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

  const meta = entries.find((entry): entry is JournalMeta => entry.type === 'meta')
  if (!meta)
    throw new Error(`journal 缺少 meta：${path}（加 --fresh 重新开始）`)

  const tweets = entries.filter((entry): entry is JournalTweetEntry => entry.type === 'tweet')
  const errors = entries
    .filter((entry): entry is JournalErrorEntry => entry.type === 'error')
    .map(entry => entry.issue)

  let lastCheckpoint: ArchiveCheckpoint | undefined
  for (const entry of entries) {
    if (entry.type === 'tweet' && entry.checkpoint)
      lastCheckpoint = entry.checkpoint
    else if (entry.type === 'checkpoint')
      lastCheckpoint = entry.checkpoint
  }

  return { meta, tweets, errors, lastCheckpoint, repaired }
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
  const journalPath = `${outPath}.journal.jsonl`

  let journal: LoadedJournal | undefined
  if (values.fresh) {
    if (existsSync(journalPath))
      rmSync(journalPath, { force: true })
  }
  else {
    journal = readJournal(journalPath)
  }

  let config: RunConfig
  if (journal) {
    assertResumeConfig(journal.meta.config, uid, provided, values)
    config = journal.meta.config
    console.error(
      `[archive] resume journal=${journalPath} tweets=${journal.tweets.length}`
      + `${journal.lastCheckpoint === undefined ? '' : ` phase=${journal.lastCheckpoint.phase}`}`,
    )
  }
  else {
    config = buildConfig(uid, values)
  }

  const { sinceUnix, untilUnix } = {
    sinceUnix: config.range.since.unix,
    untilUnix: config.range.until.unix,
  }
  const options = config.options

  if (existsSync(outPath) && !values.force && journal === undefined)
    throw new Error(`输出文件已存在：${outPath}（加 --force 覆盖，或保留 journal 续跑）`)

  const rawOutPath = (() => {
    if (typeof values['raw-out'] === 'string' && values['raw-out'].trim() !== '')
      return resolve(process.cwd(), values['raw-out'])
    if (values.raw)
      return `${outPath}.raw.ndjson`
    return undefined
  })()
  if (rawOutPath !== undefined) {
    if (rawOutPath === outPath || rawOutPath === journalPath)
      throw new Error('raw 路径不能与归档 JSON / journal 相同')
    if (journal === undefined) {
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
              console.error(`[archive] raw write failed: ${rawWriteError}`)
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
    ...(rawHooks === undefined ? {} : { hooks: rawHooks }),
  })

  console.error(`[archive] uid=${uid} since=${new Date(sinceUnix * 1000).toISOString()} until=${new Date(untilUnix * 1000).toISOString()}`)
  console.error(`[archive] out=${outPath}`)
  if (rawOutPath !== undefined)
    console.error(`[archive] raw=${rawOutPath}`)

  let user: IUser
  if (journal) {
    try {
      user = await sdk.users.getById(uid)
    }
    catch (error) {
      user = journal.meta.user
      console.error(`[archive] user refresh failed, using journal meta: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  else {
    user = await sdk.users.getById(uid)
    const meta: JournalMeta = {
      type: 'meta',
      schema: JOURNAL_SCHEMA,
      createdAt: new Date().toISOString(),
      config,
      user,
    }
    writeFileAtomic(journalPath, `${JSON.stringify(meta)}\n`)
    console.error(`[archive] journal=${journalPath}`)
  }
  console.error(`[archive] user=${user.name} (${user.id}) statuses=${user.stats.statuses}`)

  const journalTweets: JournalTweetEntry[] = journal?.tweets.slice() ?? []
  const bestBefore = dedupeJournalTweets(journalTweets)
  const completed = new Set(bestBefore.filter(entry => entry.issues.length === 0).map(entry => entry.mblogId))
  const retryTargets = new Map(
    bestBefore
      .filter(entry => entry.issues.length > 0)
      .map(entry => [entry.mblogId, entry] as const),
  )
  const attempted = new Set<string>()
  const enumIssues: ArchiveIssue[] = []
  let lastCheckpoint = journal?.lastCheckpoint
  let fatalError: unknown
  let processed = 0

  const persistCheckpoint = (checkpoint: ArchiveCheckpoint | undefined): void => {
    if (!checkpoint || checkpoint.uid !== uid)
      return
    lastCheckpoint = checkpoint
    appendJournal(journalPath, { type: 'checkpoint', checkpoint })
  }

  try {
    for await (const item of sdk.archive.streamArchive(uid, {
      timelineSource: 'search',
      since: sinceUnix,
      until: untilUnix,
      includeReposts: false,
      includeFavorites: false,
      includeComments: false,
      includeDateSlices: true,
      checkpoint: lastCheckpoint?.uid === uid ? lastCheckpoint : undefined,
      onProgress: (progress) => {
        console.error(
          `[archive] phase=${progress.phase} source=${progress.source ?? '-'} page=${progress.page ?? '-'} processed=${progress.processed}`,
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
        appendJournal(journalPath, { type: 'error', issue })
        console.error(
          `[archive] error stage=${context.stage} source=${context.source} mblogId=${context.mblogId ?? '-'}: ${error instanceof Error ? error.message : String(error)}`,
        )
        // 枚举阶段失败默认中止，避免把缺页当成完整归档。
        return undefined
      },
    })) {
      if (item.source !== 'timeline' || !item.tweet || !item.mblogId)
        continue

      // 已完整处理过：只推进 checkpoint，不重复请求。
      if (completed.has(item.mblogId)) {
        persistCheckpoint(item.checkpoint)
        continue
      }
      if (attempted.has(item.mblogId))
        continue
      if (!withinRange(item.tweet, sinceUnix, untilUnix)) {
        persistCheckpoint(item.checkpoint)
        continue
      }

      attempted.add(item.mblogId)
      const { tweet, issues } = await archiveOne(sdk, item.tweet, options)
      const entry: JournalTweetEntry = {
        type: 'tweet',
        mblogId: item.mblogId,
        record: tweet,
        issues,
        ...(item.checkpoint === undefined ? {} : { checkpoint: item.checkpoint }),
      }
      journalTweets.push(entry)
      appendJournal(journalPath, entry)
      if (item.checkpoint && item.checkpoint.uid === uid)
        lastCheckpoint = item.checkpoint

      if (issues.length === 0) {
        completed.add(item.mblogId)
        retryTargets.delete(item.mblogId)
      }
      processed += 1

      const replyCount = tweet.comments.reduce((sum, comment) => sum + (comment.replies?.length ?? 0), 0)
      console.error(
        `[${processed}] ${tweet.mblogId} comments=${tweet.comments.length} replies=${replyCount}`
        + `${issues.length === 0 ? '' : ` errors=${issues.length}`}`,
      )
    }
  }
  catch (error) {
    fatalError = error
  }

  // 断点之前已经失败过的微博：本次枚举不一定会再遇到，补一轮重试。
  for (const [mblogId, entry] of retryTargets) {
    if (attempted.has(mblogId))
      continue
    attempted.add(mblogId)
    const { tweet, issues } = await archiveOne(sdk, entry.record.tweet, options)
    const line: JournalTweetEntry = {
      type: 'tweet',
      mblogId,
      record: tweet,
      issues,
      ...(lastCheckpoint === undefined ? {} : { checkpoint: lastCheckpoint }),
    }
    journalTweets.push(line)
    appendJournal(journalPath, line)
    const replyCount = tweet.comments.reduce((sum, comment) => sum + (comment.replies?.length ?? 0), 0)
    console.error(
      `[retry] ${mblogId} comments=${tweet.comments.length} replies=${replyCount}`
      + `${issues.length === 0 ? ' OK' : ` errors=${issues.length}`}`,
    )
  }

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

  console.error(
    `[archive] done tweets=${output.stats.tweets} comments=${output.stats.comments} replies=${output.stats.replies} errors=${output.stats.errors}`,
  )
  console.error(`[archive] wrote ${outPath}`)
  if (rawOutPath !== undefined) {
    if (rawWriteError !== undefined)
      console.error(`[archive] raw incomplete: ${rawOutPath} lines=${rawLineCount}: ${rawWriteError}`)
    else
      console.error(`[archive] raw=${rawOutPath} lines=${rawLineCount}`)
  }

  if (complete) {
    rmSync(journalPath, { force: true })
    console.error(`[archive] journal removed`)
  }
  else {
    console.error(`[archive] journal kept for resume: ${journalPath}`)
  }

  if (fatalError !== undefined)
    throw fatalError
  if (allErrors.length > 0 || rawWriteError !== undefined)
    process.exitCode = 1
}

run().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
