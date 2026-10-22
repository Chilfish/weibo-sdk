import type { ArchivedTweet } from '../../src/types/archive/IArchiveFile'
import type {
  JournalErrorEntry,
  JournalMeta,
  JournalPaths,
  JournalTweetEntry,
  LoadedSliceJournal,
  SliceJournalEntry,
} from './types'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { JOURNAL_SCHEMA } from './constants'

export function createJournalPaths(outPath: string): JournalPaths {
  const partsDir = `${outPath}.slices`
  return {
    outPath,
    partsDir,
    metaPath: join(partsDir, 'meta.json'),
    legacyJournalPath: `${outPath}.journal.jsonl`,
    slicePath: key => join(partsDir, `${key}.journal.jsonl`),
  }
}

let tempFileSeq = 0

export function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  tempFileSeq += 1
  const tempPath = `${path}.${process.pid}.${tempFileSeq}.tmp`
  writeFileSync(tempPath, content, 'utf8')
  renameSync(tempPath, path)
}

export function appendJournal(path: string, entry: SliceJournalEntry): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 旧 journal 可能带 raw；归档 JSON 不再包含 raw，读取时统一剥掉。 */
export function stripRaw(record: ArchivedTweet): ArchivedTweet {
  if (!('raw' in record))
    return record
  const copy = { ...record }
  delete (copy as { raw?: unknown }).raw
  return copy
}

/** 读取并校验 `<out>.slices/meta.json`；缺失表示全新运行。 */
export function readMeta(path: string): JournalMeta | undefined {
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

/**
 * 读取单个切片的 journal；最后一行可能因进程被杀而截断，解析失败的行会被丢弃，
 * 并把修好的内容原子写回，避免后续 append 拼到半行后面。
 */
export function readSliceJournal(path: string): LoadedSliceJournal {
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
      entries.push(parsed as unknown as SliceJournalEntry)
      continue
    }
    if (parsed.type === 'slice-done') {
      if (typeof parsed.slice !== 'string') {
        repaired = true
        continue
      }
      entries.push(parsed as unknown as SliceJournalEntry)
      continue
    }
    if (parsed.type === 'error') {
      if (!isRecord(parsed.issue) || (parsed.slice !== undefined && typeof parsed.slice !== 'string')) {
        repaired = true
        continue
      }
      entries.push(parsed as unknown as SliceJournalEntry)
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

  let checkpoint: LoadedSliceJournal['checkpoint']
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
export function dedupeJournalTweets(tweets: JournalTweetEntry[]): JournalTweetEntry[] {
  const byId = new Map<string, JournalTweetEntry>()
  for (const entry of tweets) {
    const current = byId.get(entry.mblogId)
    if (!current || entry.issues.length <= current.issues.length)
      byId.set(entry.mblogId, entry)
  }
  return [...byId.values()]
}

/** 处理 `--out` 相对路径；未提供时用 uid 生成默认文件名。 */
export function resolveOutPath(cwd: string, out: string | undefined, uid: string): string {
  return resolve(cwd, out !== undefined && out.trim() !== '' ? out : `weibo-archive-${uid}.json`)
}
