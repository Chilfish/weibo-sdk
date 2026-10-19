#!/usr/bin/env node
/**
 * P2-3 · telemetry 消费端示例：把 Wide Events 落成 JSONL（NDJSON）。
 *
 * 用法：
 *   node examples/telemetry-jsonl.mjs               # 只把 JSONL 写到 stdout（每行一个事件）
 *   node examples/telemetry-jsonl.mjs > events.jsonl
 *   node examples/telemetry-jsonl.mjs | jq -c 'select(.event_name=="archive_progress")'
 *
 * 约定 / 说明：
 * - **纯离线**：不读 .env、不发请求；`WeiboSDK` 用 `selfCheck: { mode: 'none' }` 构造，
 *   构造期只会 emit 一条 `sdk_init` Wide Event。
 * - exporter 本身不做 IO 假设（行写入靠注入的 `write`），浏览器端可换成
 *   `fetch(...).body` / IndexedDB 批量写入；Node 端可换成 `fs.createWriteStream().write`。
 * - stdout 只放 JSONL，人类可读的摘要走 stderr，方便直接重定向给下游消费。
 * - 本文件直接 import TS 源码（Node ≥ 22.18 / 24 的类型剥离），因此无需先 `pnpm build`；
 *   真实下游从包入口取同样的函数：`import { createJsonlTelemetry } from 'weibo-sdk'`。
 */
import { createJsonlTelemetry, formatArchiveProgress, isArchiveProgress } from '../src/utils/telemetryJsonl.ts'

/** 一行一个事件的 JSONL exporter（`write` 收到的是带行尾 `\n` 的完整行）。 */
const telemetry = createJsonlTelemetry({
  write: line => process.stdout.write(line),
  // 只要归档进度就加这一行（其它事件会静默丢弃并计入 telemetry.dropped）：
  // filter: isArchiveProgress,
})

/** 与 ArchiveService P1-3 的 `archive_progress` 形状一致（其中一条故意不给 total）。 */
const fakeEvents = [
  {
    event_name: 'archive_progress',
    timestamp: Date.now(),
    trace_id: 'demo-trace-1',
    uid: '1234567890',
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
    uid: '1234567890',
    phase: 'favorites',
    processed: 3,
    source: 'allfav',
    page: 1,
  },
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

async function main() {
  // 1) 接入 SDK：`telemetry.emit` 就是 JSONL 出口，长任务里每个进度事件都会变成一行。
  try {
    const { WeiboSDK } = await import('weibo-sdk')
    const sdk = new WeiboSDK({
      cookie: 'SUB=example; XSRF-TOKEN=example',
      telemetry,
      selfCheck: { mode: 'none' },
    })
    // 真实长任务用法（本示例不触网）：
    //   for await (const { tweet } of sdk.archive.streamArchive(uid, { checkpoint })) { ... }
    void sdk
  }
  catch (error) {
    console.error(`[example] 跳过 SDK 接线（先跑 \`pnpm build\` 才有 dist）：${error.message}`)
    console.error('[example] 下面继续用假事件验证 exporter 本身。')
  }

  // 2) 假事件走同一条通路（stdout 得到 3 行合法 JSONL）。
  for (const event of fakeEvents)
    await telemetry.emit(event)

  // 3) 消费端过滤 + 进度换算：只取 archive_progress，算百分比 / 剩余。
  const summaries = fakeEvents.filter(isArchiveProgress).map(formatArchiveProgress)
  for (const summary of summaries) {
    console.error(
      `[example] ${summary.text} → percent=${summary.percent ?? 'n/a'} remaining=${summary.remaining ?? 'n/a'}`,
    )
  }
  console.error(`[example] wrote ${telemetry.written} line(s), dropped ${telemetry.dropped}`)
}

main().catch((error) => {
  console.error('[example] failed:', error)
  process.exitCode = 1
})
