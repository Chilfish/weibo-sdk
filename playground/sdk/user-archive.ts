import type { SdkScenario } from '../lib/types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { argument, flagBool, flagNumber, flagString } from '../lib/args'
import { defaultUid } from '../lib/defaults'

function defaultSince(): string {
  const date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

/** 范围归档：切片枚举 + 单条补全 + 单文件产出 + 可续跑。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'user-archive',
  title: '用户范围归档',
  summary: 'userArchive.run：指定时间范围、详情/评论/楼中楼/转发补全、单文件产出',
  usage: 'pnpm play user-archive [uid] [--since 2025-01-01] [--until 2025-01-31] [--reposts] [--no-comments] [--slice-days 30]',
  async run({ sdk, args, env, paths, log }) {
    const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
    const since = flagString(args, 'since') ?? defaultSince()
    const until = flagString(args, 'until') ?? new Date().toISOString().slice(0, 10)
    const includeComments = !flagBool(args, 'no-comments', false)
    const includeReplies = !flagBool(args, 'no-replies', false)
    const includeReposts = flagBool(args, 'reposts', false)
    const sliceDays = flagNumber(args, 'slice-days', 30)
    const concurrency = flagNumber(args, 'concurrency', 6)
    const dir = join(paths.output, 'user-archive')
    const outPath = join(dir, `${uid}.json`)

    mkdirSync(dir, { recursive: true })
    log.kv('uid', uid)
    log.kv('range', `${since} ~ ${until}`)
    log.kv('content', { includeComments, includeReplies, includeReposts })
    log.kv('sliceDays', sliceDays)
    log.kv('out', outPath)

    if (flagBool(args, 'stream', false)) {
      let events = 0
      for await (const event of sdk.userArchive.stream(uid, {
        since,
        until,
        sliceDays,
        includeComments,
        includeReplies,
        includeReposts,
        concurrency,
      })) {
        events += 1
        if (events <= 5)
          log.info(`- event ${event.type}`)
      }
      log.kv('stream events', events)
      log.info('流式事件：meta / slice-start / record / issue / slice-done / done；适合边跑边写自己的存储。')
      return
    }

    const result = await sdk.userArchive.run(uid, {
      since,
      until,
      sliceDays,
      includeComments,
      includeReplies,
      includeReposts,
      concurrency,
      onProgress: progress => log.progress(
        `${progress.slice}/${progress.phase}`,
        progress.processed,
        progress.total,
      ),
      onIssue: issue => log.warn(`${issue.stage} ${issue.code}: ${issue.message}`),
    })

    writeFileSync(outPath, `${JSON.stringify(result.file, null, 2)}\n`, 'utf8')
    log.kv('complete', result.complete)
    log.kv('summary', result.summary)
    log.info('归档 JSON 已写出；范围归档不带 raw，需要原始响应时用 CLI 的 --raw 或 config.hooks.onRaw。')
  },
}
