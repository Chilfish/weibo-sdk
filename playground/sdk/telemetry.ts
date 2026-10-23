import type { SdkScenario } from '../lib/types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createJsonlTelemetry, formatArchiveProgress, isArchiveProgress } from '@chilfish/weibo-sdk'

/** 纯离线：把 Wide Events 落成 JSONL，并计算归档进度摘要。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'telemetry',
  title: 'Wide Events → JSONL（离线）',
  summary: 'createJsonlTelemetry + isArchiveProgress + formatArchiveProgress',
  usage: 'pnpm play telemetry',
  requiresCookie: false,
  async run({ paths, log }) {
    const lines: string[] = []
    const telemetry = createJsonlTelemetry({
      write: (line) => {
        lines.push(line)
      },
      // 只保留归档进度；其它事件会被丢弃并计入 dropped。
      filter: isArchiveProgress,
    })

    const progressEvents = [
      {
        event_name: 'archive_progress',
        timestamp: Date.now(),
        trace_id: 'demo-trace-1',
        uid: '1111681197',
        phase: 'timeline',
        processed: 25,
        total: 200,
        remaining: 175,
        source: 'mymblog',
        page: 2,
      },
      {
        event_name: 'archive_progress',
        timestamp: Date.now(),
        trace_id: 'demo-trace-1',
        uid: '1111681197',
        phase: 'favorites',
        processed: 3,
        source: 'allfav',
        page: 1,
      },
    ]
    const otherEvents = [
      {
        event_name: 'rate_limit_wait',
        timestamp: Date.now(),
        trace_id: 'demo-trace-2',
        wait_ms: 800,
        refill_rate_ms: 1000,
        max_tokens: 3,
        tokens: 1,
      },
    ]

    for (const event of [...progressEvents, ...otherEvents])
      await telemetry.emit(event)

    log.heading('归档进度摘要')
    for (const event of progressEvents) {
      if (!isArchiveProgress(event))
        continue
      const summary = formatArchiveProgress(event)
      log.info(`${summary.text} → percent=${summary.percent ?? 'n/a'} remaining=${summary.remaining ?? 'n/a'}`)
    }

    const dir = join(paths.output, 'telemetry')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'events.ndjson')
    writeFileSync(file, lines.join(''))

    log.kv('written', telemetry.written)
    log.kv('dropped', telemetry.dropped)
    log.kv('file', file)
    log.info('接入真实 SDK：new WeiboSDK({ cookie, telemetry })；emit 失败会被吞掉。')
    log.info('消费端可直接 `jq -c \'select(.event_name=="archive_progress")\' events.ndjson`。')
  },
}
