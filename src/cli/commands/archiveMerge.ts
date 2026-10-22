import type { ArchiveFile } from '~/types/archive/IArchiveFile'
import { existsSync, readFileSync } from 'node:fs'
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

/** 执行 `archive merge <a.json> <b.json...>`。 */
export async function runArchiveMerge(
  inputs: string[],
  args: Record<string, unknown> = {},
  cwd: string = process.cwd(),
): Promise<RunArchiveMergeResult> {
  if (inputs.length < 2) {
    throw new InvalidConfigError('archive merge needs at least two archive files.', {
      field: 'inputs',
      value: inputs,
    })
  }

  const paths = inputs.map(input => resolve(cwd, input))
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

  const merged = mergeArchiveFiles(paths.map(readArchiveFile))
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
