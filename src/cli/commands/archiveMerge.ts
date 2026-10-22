import type { ArchiveFile } from '~/types/archive/IArchiveFile'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { mergeArchiveFiles } from '~/services/public/userArchive/merge'
import { writeFileAtomic } from '../archiveUser/store'

const BOM_RE = /^\uFEFF/

/** 读取归档 JSON；结构校验交给 `mergeArchiveFiles`。 */
export function readArchiveFile(path: string): ArchiveFile {
  if (!existsSync(path)) {
    throw new InvalidConfigError(`Archive not found: ${path}`, {
      field: 'archive',
      value: path,
    })
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(BOM_RE, '')) as ArchiveFile
  }
  catch (error) {
    throw new InvalidConfigError(`Archive is not valid JSON: ${path}`, {
      field: 'archive',
      value: path,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

export interface RunArchiveMergeResult {
  outPath: string
  inputs: number
  tweets: number
  comments: number
  replies: number
  errors: number
  complete: boolean
  deduped: number
}

export interface ArchiveMergeSkip {
  path: string
  reason: string
}

interface ExpandedInputs {
  paths: string[]
  skipped: ArchiveMergeSkip[]
  directoryCount: number
}

/** 单份归档能否独立合并；返回不可合并的原因。 */
function unmergeableReason(file: ArchiveFile): string | undefined {
  try {
    mergeArchiveFiles([file])
    return undefined
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return message.replace(/^Input #\d+\s+/, '').replace(/^is\s+/, '')
  }
}

/**
 * 展开输入：显式文件原样保留（缺失 / 非法仍在合并阶段报错），
 * 目录只取顶层 `*.json`，逐份校验后跳过不可合并的文件。
 */
function expandInputs(inputs: string[], cwd: string, outPath: string): ExpandedInputs {
  const paths: string[] = []
  const skipped: ArchiveMergeSkip[] = []
  const seen = new Set<string>()
  let directoryCount = 0

  const add = (path: string): void => {
    if (seen.has(path))
      return
    seen.add(path)
    paths.push(path)
  }

  for (const input of inputs) {
    const path = resolve(cwd, input)
    if (!existsSync(path)) {
      throw new InvalidConfigError(`Archive not found: ${path}`, {
        field: 'archive',
        value: path,
      })
    }

    if (!statSync(path).isDirectory()) {
      add(path)
      continue
    }

    directoryCount += 1
    const entries = readdirSync(path, { withFileTypes: true })
      .filter(entry => (entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith('.json'))
      .map(entry => resolve(path, entry.name))
      .sort((a, b) => a.localeCompare(b))

    for (const entryPath of entries) {
      if (entryPath === outPath) {
        skipped.push({ path: entryPath, reason: 'output file' })
        continue
      }

      let file: ArchiveFile
      try {
        file = readArchiveFile(entryPath)
      }
      catch (error) {
        skipped.push({ path: entryPath, reason: error instanceof Error ? error.message : String(error) })
        continue
      }

      const reason = unmergeableReason(file)
      if (reason !== undefined) {
        skipped.push({ path: entryPath, reason })
        continue
      }

      add(entryPath)
    }
  }

  return { paths, skipped, directoryCount }
}

/** 执行 `archive merge <a.json> <b.json...>`；输入也可以是目录。 */
export async function runArchiveMerge(
  inputs: string[],
  args: Record<string, unknown> = {},
  cwd: string = process.cwd(),
): Promise<RunArchiveMergeResult> {
  const outPath = resolve(
    cwd,
    typeof args.out === 'string' && args.out.trim() !== '' ? args.out : 'weibo-archive-merged.json',
  )
  if (existsSync(outPath) && args.force !== true) {
    throw new InvalidConfigError(`Output already exists: ${outPath}. Use --force to overwrite.`, {
      field: 'out',
      value: outPath,
    })
  }

  const expanded = expandInputs(inputs, cwd, outPath)
  if (expanded.paths.length < 2) {
    throw new InvalidConfigError(
      expanded.directoryCount === 0
        ? 'archive merge needs at least two archive files.'
        : `archive merge needs at least two valid archive files (found ${expanded.paths.length} in ${expanded.directoryCount} directory input(s)).`,
      { field: 'inputs', value: inputs },
    )
  }

  if (args.quiet !== true) {
    for (const item of expanded.skipped)
      console.error(`[archive merge] 跳过 ${item.path}：${item.reason}`)
  }

  const merged = mergeArchiveFiles(expanded.paths.map(readArchiveFile))
  writeFileAtomic(outPath, `${JSON.stringify(merged.file, null, 2)}\n`)

  const { stats, complete } = merged.file
  if (args.quiet !== true) {
    console.error(
      `[archive merge] ${merged.inputs} 份：${merged.inputTweets} 条 → ${merged.tweets} 条`
      + `（去重 ${merged.deduped}）${complete ? '' : '，仍有未解决的 issue'}`,
    )
    console.error(`[archive merge] 写入 ${outPath}`)
  }

  console.log(JSON.stringify({
    event: 'done',
    out: outPath,
    inputs: merged.inputs,
    tweets: stats.tweets,
    comments: stats.comments,
    replies: stats.replies,
    errors: stats.errors,
    complete,
    deduped: merged.deduped,
  }))

  if (!complete)
    process.exitCode = 1

  return {
    outPath,
    inputs: merged.inputs,
    tweets: stats.tweets,
    comments: stats.comments,
    replies: stats.replies,
    errors: stats.errors,
    complete,
    deduped: merged.deduped,
  }
}
