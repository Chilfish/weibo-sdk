import type { CaptureHost } from '../src/types'
// capture/bin/index.ts — capture SDK CLI（citty，与主 CLI 一致）
// 用法: pnpm capture --uid 2365795232 [--out dir] [--seconds 15] [--headed]
import { defineCommand, runMain } from 'citty'
import { capture } from '../src/index'

const main = defineCommand({
  meta: {
    name: 'capture',
    description: 'CDP 驱动浏览器抓取真实微博 API 响应（数据驱动开发 / 排障）',
  },
  args: {
    'uid': { type: 'string', description: '微博 uid，导航到个人主页' },
    'url': { type: 'string', description: '导航 URL（优先于 uid）' },
    'host': { type: 'string', description: 'cookie domain: weibo.com | weibo.cn | m.weibo.cn' },
    'out': { type: 'string', description: '落盘目录（默认不落盘）' },
    'seconds': { type: 'string', description: '监听秒数（默认 15）' },
    'headed': { type: 'boolean', description: '有头模式（默认 headless）' },
    'port': { type: 'string', description: '调试端口起点（默认 9222）' },
    'env-file': { type: 'string', description: '.env 路径（默认 <pwd>/.env）' },
  },
  async run({ args }) {
    const items = await capture({
      uid: args.uid as string | undefined,
      url: args.url as string | undefined,
      host: args.host as CaptureHost | undefined,
      outDir: args.out as string | undefined,
      seconds: args.seconds ? Number(args.seconds) : undefined,
      headless: !args.headed,
      port: args.port ? Number(args.port) : undefined,
      envFile: args['env-file'] as string | undefined,
    })
    const rows = items.map(i => ({ url: i.url, status: i.status, ok: i.ok, size: i.body.length, file: i.file }))
    console.log(JSON.stringify(rows, null, 2))
    console.error(`[capture] 共 ${items.length} 个响应`)
  },
})

runMain(main)
