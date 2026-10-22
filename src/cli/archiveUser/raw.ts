import type { UserArchivePaths } from './store'
import type { WeiboSDKRawMeta } from '~/types/hooks'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

export interface RawRecorder {
  hooks?: {
    onRaw: (raw: unknown, meta: WeiboSDKRawMeta) => void
  }
  /** 已写入的行数。 */
  lines: number
  /** 首次写入失败的错误信息。 */
  error?: string
}

export interface RawPathOptions {
  cwd: string
  /** 显式 `--raw-out`。 */
  rawOut?: string
  /** `--raw`：写到 `<out>.raw.ndjson`。 */
  raw: boolean
  paths: UserArchivePaths
  force: boolean
  resuming: boolean
}

/**
 * 解析并准备 raw sidecar 路径；返回 undefined 表示本次不记录 raw。
 *
 * 全新运行按 `--force` 规则处理已存在文件；续跑时继续追加，不截断。
 */
export function prepareRawPath(options: RawPathOptions): string | undefined {
  const { paths } = options
  const rawOutPath = (() => {
    if (options.rawOut !== undefined && options.rawOut.trim() !== '')
      return resolve(options.cwd, options.rawOut)
    if (options.raw)
      return `${paths.outPath}.raw.ndjson`
    return undefined
  })()

  if (rawOutPath === undefined)
    return undefined

  if (
    rawOutPath === paths.outPath
    || rawOutPath === paths.legacyJournalPath
    || rawOutPath === paths.metaPath
    || rawOutPath.startsWith(`${paths.partsDir}${sep}`)
  ) {
    throw new Error('raw 路径不能与归档 JSON / 切片进度目录相同')
  }

  if (!options.resuming) {
    if (existsSync(rawOutPath) && !options.force)
      throw new Error(`raw 文件已存在：${rawOutPath}（加 --force 覆盖）`)
    mkdirSync(dirname(rawOutPath), { recursive: true })
    writeFileSync(rawOutPath, '', 'utf8')
  }
  else {
    mkdirSync(dirname(rawOutPath), { recursive: true })
  }

  return rawOutPath
}

/** 把上游原始响应逐行追加到 sidecar；归档 JSON 本身不含 raw。 */
export function createRawRecorder(path: string | undefined): RawRecorder {
  if (path === undefined)
    return { lines: 0 }

  const recorder: RawRecorder = {
    lines: 0,
    hooks: {
      onRaw: (raw, meta) => {
        try {
          appendFileSync(
            path,
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
          recorder.lines += 1
        }
        catch (error) {
          if (recorder.error !== undefined)
            return
          recorder.error = error instanceof Error ? error.message : String(error)
          process.stderr.write(`${JSON.stringify({ event: 'raw-error', message: recorder.error })}\n`)
        }
      },
    },
  }
  return recorder
}
