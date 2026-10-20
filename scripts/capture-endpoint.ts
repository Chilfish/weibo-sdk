// 抓包助手：pnpm capture:endpoint <url> [--name <fixture>] [--out <path>] [--seconds 15] [--headed]
// 复用 capture/ 的 CDP 能力：打开 URL → 读取 JSON 响应 → 脱敏 → 写 fixture → 追加 INDEX.md。
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { capture } from '../capture/src/index'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function booleanFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function slugFromUrl(url: string): string {
  const parsed = new URL(url)
  const last = basename(parsed.pathname).replace(/\.[a-z0-9]+$/i, '')
  return (last || 'endpoint').replace(/[^\w-]/g, '_')
}

const url = process.argv[2]
if (!url || url.startsWith('--')) {
  console.error(
    '用法: pnpm capture:endpoint <url> [--name <fixture>] [--out <path>] [--seconds 15] [--headed]',
  )
  process.exit(1)
}

const name = flag('name') ?? slugFromUrl(url)
const seconds = Number(flag('seconds') ?? 15)
const headless = !booleanFlag('headed')
const out
  = flag('out')
    ?? join(process.cwd(), 'tests', 'fixtures', 'raw', `${name}.json`)
const tempDir = mkdtempSync(join(tmpdir(), 'weibo-capture-'))

try {
  const items = await capture({
    url,
    seconds,
    headless,
    outDir: tempDir,
  })

  const match
    = items.find(item => item.url.includes(new URL(url).pathname))
      ?? items.find(item => item.url === url)
      ?? items[0]
  if (!match) {
    console.error(
      JSON.stringify({
        event: 'error',
        message: '没有捕获到 JSON 响应；确认已登录并延长 --seconds',
      }),
    )
    process.exit(1)
  }

  const rawFile = join(tempDir, 'raw.json')
  writeFileSync(
    rawFile,
    JSON.stringify(match.json ?? JSON.parse(match.body), null, 2),
  )
  execFileSync(
    process.execPath,
    [join(process.cwd(), 'scripts', 'sanitize-raw.mjs'), rawFile, out],
    { stdio: 'inherit' },
  )

  const indexFile = join(process.cwd(), 'tests', 'fixtures', 'raw', 'INDEX.md')
  const index = readFileSync(indexFile, 'utf8')
  const relative = basename(out)
  if (!index.includes(`\`${relative}\``)) {
    const sizeKb = Math.max(
      0,
      Math.round(Buffer.byteLength(readFileSync(out, 'utf8')) / 1024),
    )
    appendFileSync(
      indexFile,
      `\n| \`${relative}\` | ${sizeKb}K | ${match.status} | \`${new URL(match.url).pathname}\` |`,
    )
  }

  console.log(
    JSON.stringify(
      {
        fixture: out,
        endpoint: new URL(match.url).pathname,
        status: match.status,
        captured: items.length,
        next: [
          '在 scripts/validate-fixtures.ts 的 FIXTURE_RULES 登记该 fixture',
          '按真实字段补全 endpoint schema 并写 safeParse 测试',
        ],
      },
      null,
      2,
    ),
  )
}
finally {
  rmSync(tempDir, { recursive: true, force: true })
}
