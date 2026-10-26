import type { ArchiveCheckpoint } from '~/services/public/ArchiveService'
import type { ArchivedTweet, ArchiveIssue } from '~/types/archive/IArchiveFile'
import type {
  UserArchiveMeta,
  UserArchiveRecord,
  UserArchiveSlice,
  UserArchiveSliceState,
  UserArchiveStore,
} from '~/types/archive/IUserArchive'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { stripUserArchiveRaw } from '~/services/public/userArchive/assemble'
import { USER_ARCHIVE_JOURNAL_SCHEMA } from '~/types/archive/IUserArchive'

export interface UserArchivePaths {
  outPath: string
  /** 切片进度目录；完整结束后删除。 */
  partsDir: string
  metaPath: string
  /** 旧版单文件 journal；只用于检测并提示 --fresh。 */
  legacyJournalPath: string
  slicePath: (key: string) => string
}

export function createUserArchivePaths(outPath: string): UserArchivePaths {
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

/** 原子写：先写临时文件再 rename，避免进程中断留下半截 JSON。 */
export function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  tempFileSeq += 1
  const tempPath = `${path}.${process.pid}.${tempFileSeq}.tmp`
  writeFileSync(tempPath, content, 'utf8')
  renameSync(tempPath, path)
}

function appendLine(path: string, entry: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8')
}

const JOURNAL_SUFFIX = '.journal.jsonl'

/**
 * 列出进度目录下所有切片 journal 的 key。
 *
 * 不依赖 meta.slices：`resume: 'merge'` 会按新范围重写 meta，旧 key 的 journal
 * 仍要能被 `loadRecords()` / `loadIssues()` 读到，否则已有记录会被丢掉。
 */
function listJournalKeys(partsDir: string): string[] {
  try {
    return readdirSync(partsDir)
      .filter(name => name.endsWith(JOURNAL_SUFFIX))
      .map(name => name.slice(0, -JOURNAL_SUFFIX.length))
      .sort()
  }
  catch {
    return []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

type SliceJournalEntry
  = | { type: 'tweet', slice: string, mblogId: string, record: ArchivedTweet, issues: ArchiveIssue[], checkpoint?: ArchiveCheckpoint }
    | { type: 'checkpoint', slice: string, checkpoint: ArchiveCheckpoint }
    | { type: 'slice-done', slice: string }
    | { type: 'error', slice?: string, issue: ArchiveIssue }

interface LoadedJournal {
  records: UserArchiveRecord[]
  issues: ArchiveIssue[]
  done: boolean
  checkpoint?: ArchiveCheckpoint
  repaired: boolean
}

/** 读取单个切片 journal；最后一行可能被截断，解析失败的行会被丢弃并原子写回。 */
function readJournal(path: string): LoadedJournal {
  if (!existsSync(path))
    return { records: [], issues: [], done: false, repaired: false }

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
      const entry = parsed as unknown as Extract<SliceJournalEntry, { type: 'tweet' }>
      entries.push({ ...entry, record: stripUserArchiveRaw(entry.record) })
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

  const records: UserArchiveRecord[] = []
  const issues: ArchiveIssue[] = []
  let done = false
  let checkpoint: ArchiveCheckpoint | undefined

  for (const entry of entries) {
    if (entry.type === 'tweet') {
      records.push({
        slice: entry.slice,
        mblogId: entry.mblogId,
        record: entry.record,
        issues: entry.issues,
        ...(entry.checkpoint === undefined ? {} : { checkpoint: entry.checkpoint }),
      })
      if (entry.checkpoint)
        checkpoint = entry.checkpoint
    }
    else if (entry.type === 'checkpoint') {
      checkpoint = entry.checkpoint
    }
    else if (entry.type === 'error') {
      issues.push(entry.issue)
    }
    else {
      done = true
    }
  }

  return { records, issues, done, checkpoint, repaired }
}

/** 读取并校验 `<out>.slices/meta.json`；缺失表示全新运行。 */
function readMeta(path: string): UserArchiveMeta | undefined {
  if (!existsSync(path))
    return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  }
  catch {
    throw new InvalidConfigError(`meta 无法解析：${path}（加 --fresh 重新开始）`, {
      field: 'resume',
      value: path,
      hint: 'meta.json 不是合法 JSON；进度文件损坏无法续跑',
      next: '--fresh',
    })
  }

  if (
    !isRecord(parsed)
    || parsed.schema !== USER_ARCHIVE_JOURNAL_SCHEMA
    || !isRecord(parsed.config)
    || typeof parsed.config.sliceDays !== 'number'
    || !isRecord(parsed.user)
    || !Array.isArray(parsed.slices)
    || !parsed.slices.every(slice => isRecord(slice)
      && typeof slice.key === 'string'
      && typeof slice.since === 'number'
      && typeof slice.until === 'number')
  ) {
    throw new InvalidConfigError(`meta 不兼容：${path}（旧版归档进度请加 --fresh 重新开始）`, {
      field: 'resume',
      value: path,
      hint: `meta.json 的 schema 与当前版本（${USER_ARCHIVE_JOURNAL_SCHEMA}）不一致`,
      next: '--fresh',
    })
  }
  return parsed as unknown as UserArchiveMeta
}

/**
 * 基于 per-slice JSONL 的文件 store。
 *
 * 磁盘布局与 `scripts/archive-user` 完全一致，已有的 `.slices/` 进度可以直接续跑：
 * - `<out>.slices/meta.json`
 * - `<out>.slices/<slice>.journal.jsonl`（tweet / checkpoint / error / slice-done）
 */
export class FileUserArchiveStore implements UserArchiveStore {
  readonly paths: UserArchivePaths

  constructor(outPath: string) {
    this.paths = createUserArchivePaths(outPath)
  }

  async loadMeta(): Promise<UserArchiveMeta | undefined> {
    return readMeta(this.paths.metaPath)
  }

  async saveMeta(meta: UserArchiveMeta): Promise<void> {
    writeFileAtomic(this.paths.metaPath, `${JSON.stringify(meta, null, 2)}\n`)
  }

  async loadSlices(): Promise<UserArchiveSliceState[]> {
    const meta = await this.loadMeta()
    if (!meta)
      return []

    const states: UserArchiveSliceState[] = []
    for (const slice of meta.slices) {
      const journal = readJournal(this.paths.slicePath(slice.key))
      states.push({
        slice,
        done: journal.done,
        ...(journal.checkpoint === undefined ? {} : { checkpoint: journal.checkpoint }),
      })
    }
    return states
  }

  async loadRecords(slice?: string): Promise<UserArchiveRecord[]> {
    if (slice !== undefined)
      return readJournal(this.paths.slicePath(slice)).records

    return listJournalKeys(this.paths.partsDir)
      .flatMap(key => readJournal(this.paths.slicePath(key)).records)
  }

  async appendRecord(entry: UserArchiveRecord): Promise<void> {
    appendLine(this.paths.slicePath(entry.slice), { type: 'tweet', ...entry })
  }

  async saveCheckpoint(slice: UserArchiveSlice, checkpoint: ArchiveCheckpoint): Promise<void> {
    appendLine(this.paths.slicePath(slice.key), { type: 'checkpoint', slice: slice.key, checkpoint })
  }

  async markSliceDone(slice: UserArchiveSlice): Promise<void> {
    appendLine(this.paths.slicePath(slice.key), { type: 'slice-done', slice: slice.key })
  }

  async appendIssue(issue: ArchiveIssue, slice?: UserArchiveSlice): Promise<void> {
    appendLine(this.paths.slicePath(slice?.key ?? '_issues'), { type: 'error', slice: slice?.key, issue })
  }

  async loadIssues(): Promise<ArchiveIssue[]> {
    return listJournalKeys(this.paths.partsDir)
      .flatMap(key => readJournal(this.paths.slicePath(key)).issues)
  }

  async clear(): Promise<void> {
    rmSync(this.paths.partsDir, { recursive: true, force: true })
    rmSync(this.paths.legacyJournalPath, { force: true })
  }
}
