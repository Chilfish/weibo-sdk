import type { SdkScenario } from '../lib/types'
import { join } from 'node:path'
import { MediaType } from '@chilfish/weibo-sdk'
import { argument, flagBool, flagString } from '../lib/args'
import { defaultMblogId } from '../lib/defaults'

function parseMediaTypes(value: string | undefined): MediaType[] | undefined {
  if (!value)
    return undefined
  const allowed = new Set<MediaType>(Object.values(MediaType))
  const parsed = value
    .split(',')
    .map(item => item.trim())
    .filter((item): item is MediaType => allowed.has(item as MediaType))
  return parsed.length > 0 ? parsed : undefined
}

/** 单条微博媒体下载：默认 dry-run，加 --write 才落盘。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'download-media',
  title: '下载单条微博媒体',
  summary: 'downloadByMblogId({ dir, dryRun, include }) + 逐项状态与 totals',
  usage: 'pnpm play download-media [mblogId] [--include pic,video] [--write]',
  async run({ sdk, args, env, paths, log }) {
    const mblogId = argument(args, 0, 'PLAYGROUND_MBLOG_ID', env.values, defaultMblogId(env.values))
    const include = parseMediaTypes(flagString(args, 'include'))
    const write = flagBool(args, 'write', false)
    const dir = join(paths.output, 'media')

    const result = await sdk.media.downloadByMblogId(mblogId, {
      dir,
      dryRun: !write,
      ...(include ? { include } : {}),
      onProgress: progress => log.progress('download', progress.completed, progress.total),
    })

    log.kv('mblogId', result.mblogId)
    log.kv('dryRun', result.dryRun)
    log.kv('dir', result.dir)
    log.kv('totals', JSON.stringify(result.totals))
    if (result.errorsFile)
      log.kv('errorsFile', result.errorsFile)

    for (const item of result.items.slice(0, 10)) {
      const detail = item.status === 'failed'
        ? `${item.code} ${item.message}`
        : item.path || item.url
      log.info(`- ${item.status} ${item.type} ${detail}`)
    }
    if (result.items.length > 10)
      log.info(`... 共 ${result.items.length} 项`)

    if (!write)
      log.warn('默认 dry-run（只规划不落盘）；加 --write 才会真正下载。')
  },
}
