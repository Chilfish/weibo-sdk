import type { WeiboSDK } from '@chilfish/weibo-sdk'
import type { ParsedArgs, SdkScenario } from '../lib/types'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { argument, flagBool, flagNumber, flagString } from '../lib/args'
import { defaultUid } from '../lib/defaults'
import { describeError } from '../lib/log'

type ArchiveOptions = NonNullable<Parameters<WeiboSDK['archive']['streamArchive']>[1]>
type ArchiveCheckpoint = NonNullable<ArchiveOptions['checkpoint']>

function readCheckpoint(path: string): ArchiveCheckpoint | undefined {
  if (!existsSync(path))
    return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ArchiveCheckpoint
  }
  catch {
    return undefined
  }
}

function buildIncremental(args: ParsedArgs): ArchiveOptions['incremental'] {
  const since = flagString(args, 'since')
  const stopAt = flagString(args, 'stop-at')
  if (!since && !stopAt)
    return undefined
  return {
    ...(since ? { since } : {}),
    ...(stopAt ? { stopAtMblogId: stopAt } : {}),
  }
}

/** 单账号归档：checkpoint / 增量 / 可选数据源 / 原始响应落盘。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'archive',
  title: '单账号归档',
  summary: 'streamArchive + checkpoint 续跑 + incremental + 多数据源 + onRaw / onItemError',
  usage: 'pnpm play archive [uid] [--likes --images --videos --favorites] [--resume] [--max-pages 1] [--raw]',
  async run({ sdk, args, env, paths, log }) {
    const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
    const dryRun = flagBool(args, 'dry-run', false)
    const resume = flagBool(args, 'resume', false)
    const withRaw = flagBool(args, 'raw', false)
    const maxPages = flagNumber(args, 'max-pages', 1)
    const maxItems = flagNumber(args, 'max-items', 200)

    const dir = join(paths.output, 'archive', uid)
    const itemsPath = join(dir, 'items.ndjson')
    const rawPath = join(dir, 'raw.ndjson')
    const checkpointPath = join(dir, 'checkpoint.json')
    const checkpoint = resume ? readCheckpoint(checkpointPath) : undefined
    const incremental = buildIncremental(args)

    if (!dryRun)
      mkdirSync(dir, { recursive: true })

    log.kv('uid', uid)
    log.kv('dir', dryRun ? '(dry-run，不落盘)' : dir)
    log.kv('resume', checkpoint ? `从 checkpoint 续跑（phase=${checkpoint.phase}）` : '否')
    log.kv('incremental', incremental ?? '未启用')
    log.kv('sources', [
      'timeline',
      ...(flagBool(args, 'likes') ? ['likes'] : []),
      ...(flagBool(args, 'comment-history') ? ['commentHistory'] : []),
      ...(flagBool(args, 'favorites') ? ['favorites'] : []),
      ...(flagBool(args, 'images') ? ['images'] : []),
      ...(flagBool(args, 'videos') ? ['videos'] : []),
    ].join(' → '))

    let count = 0
    const bySource = new Map<string, number>()

    for await (const item of sdk.archive.streamArchive(uid, {
      includeReposts: flagBool(args, 'reposts', true),
      includeFavorites: flagBool(args, 'favorites', false),
      includeLikes: flagBool(args, 'likes', false),
      includeCommentHistory: flagBool(args, 'comment-history', false),
      includeImages: flagBool(args, 'images', false),
      includeVideos: flagBool(args, 'videos', false),
      maxPagesPerPhase: maxPages,
      checkpoint,
      incremental,
      onProgress: progress => log.progress(
        `${progress.phase}${progress.source ? `/${progress.source}` : ''}`,
        progress.processed,
        progress.total,
      ),
      onItemError: (error, context) => {
        log.warn(`${context.stage} 失败（${describeError(error).code ?? 'UNKNOWN'}），按 skip 继续`)
        return 'skip'
      },
      ...(withRaw && !dryRun
        ? {
            onRaw: async (raw, meta) => {
              appendFileSync(rawPath, `${JSON.stringify({ meta, raw })}\n`)
            },
          }
        : {}),
    })) {
      count += 1
      bySource.set(item.source, (bySource.get(item.source) ?? 0) + 1)

      if (!dryRun) {
        appendFileSync(itemsPath, `${JSON.stringify(item)}\n`)
        writeFileSync(checkpointPath, JSON.stringify(item.checkpoint, null, 2))
      }

      if (count <= 3)
        log.info(`- ${item.source} ${item.mblogId ?? item.asset?.id ?? '-'} phase=${item.checkpoint.phase}`)

      if (count >= maxItems) {
        log.warn(`达到 --max-items=${maxItems}，提前结束。`)
        break
      }
    }

    log.kv('items', count)
    log.kv('bySource', Object.fromEntries(bySource))
    if (!dryRun) {
      log.kv('items file', itemsPath)
      log.kv('checkpoint', checkpointPath)
      if (withRaw)
        log.kv('raw file', rawPath)
      log.info('下次加 --resume 会读取 checkpoint，从上次位置继续。')
    }
    else {
      log.warn('dry-run：只遍历不落盘；去掉 --dry-run 才会写 NDJSON / checkpoint。')
    }
  },
}
