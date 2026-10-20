#!/usr/bin/env node
// scripts/spike-cdp-capture.mjs
// CDP 驱动浏览器抓取真实微博 API 响应。legacy：已被 capture/ 取代，新流程请用 `pnpm capture`。
//
// 用法（PowerShell）:
//   node scripts/spike-cdp-capture.mjs --uid 2365795232 --out tests/fixtures/raw/cdp
//   node scripts/spike-cdp-capture.mjs --url "https://m.weibo.cn/api/container/getIndex?containerid=..." --host m.weibo.cn
//
// 可选参数:
//   --uid <uid>     导航到个人主页（触发 profile/mymblog/friendships 等多个 API）
//   --url <url>     直接指定导航 URL（优先于 --uid）
//   --host <host>   cookie 注入 domain：weibo.com(默认) | weibo.cn | m.weibo.cn
//   --out <dir>     输出目录（默认 tests/fixtures/raw/cdp）
//   --seconds <n>   监听时长秒数（默认 15）
//   --headed        有头模式（默认 headless=new，被风控时改用）
//   --port <n>      调试端口起点（默认 9222 起自动找空闲）
//
// 前置: 本机 Chrome；.env 含有效 WEIBO_COOKIE（先跑 node scripts/spike-diag.mjs 验证 ok:1）
// 依赖: Node 24+（原生 WebSocket / fetch），零第三方依赖

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── 参数解析 ────────────────────────────────────────────
const argv = process.argv.slice(2)
function val(name, def) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const uid = val('--uid', '')
const urlOverride = val('--url', '')
const host = val('--host', 'weibo.com')
const outDir = join(ROOT, val('--out', 'tests/fixtures/raw/cdp'))
const seconds = Number(val('--seconds', '15'))
const headed = argv.includes('--headed')
const startPort = Number(val('--port', '9222'))
const targetUrl = urlOverride || (uid ? `https://weibo.com/u/${uid}` : 'https://weibo.com/')

config({ path: join(ROOT, '.env'), override: true, quiet: true })
const cookieStr = process.env.WEIBO_COOKIE || ''
if (!cookieStr) {
  console.error('✗ .env 缺 WEIBO_COOKIE；先跑 node scripts/spike-diag.mjs 验证 cookie 有效')
  process.exit(1)
}

const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
if (!existsSync(CHROME)) {
  console.error(`✗ 未找到 Chrome: ${CHROME}，用环境变量 CHROME_PATH 指定路径`)
  process.exit(1)
}

// ── 工具 ────────────────────────────────────────────────
async function findFreePort(from) {
  for (let p = from; p < from + 10; p++) {
    try {
      await fetch(`http://127.0.0.1:${p}/json/version`)
    }
    catch {
      return p // 连接拒绝 = 端口空闲
    }
  }
  return from
}

function parseCookies(cookieStr) {
  return cookieStr.split(';').map(s => s.trim()).filter(Boolean).map((part) => {
    const i = part.indexOf('=')
    return { name: part.slice(0, i).trim(), value: part.slice(i + 1).trim(), domain: `.${host}`, path: '/' }
  })
}

function isApi(url) {
  if (/\.(?:js|css|png|jpe?g|gif|svg|woff2?|mp4|webp|ico)(?:\?|$)/i.test(url))
    return false
  if (/\/log\/action/.test(url))
    return false // 埋点噪声
  return /weibo\.com\/ajax\//.test(url)
    || /weibo\.cn\/api\//.test(url)
    || /m\.weibo\.cn\/api\//.test(url)
}

function fileName(url, seq) {
  const u = new URL(url)
  const path = u.pathname.replace(/\/+/g, '_').replace(/^_/, '') || 'root'
  const uidp = u.searchParams.get('uid')
  const page = u.searchParams.get('page')
  let name = `${String(seq).padStart(3, '0')}_${path}`
  if (uidp)
    name += `_u${uidp}`
  if (page)
    name += `_p${page}`
  return name
}

// ── 极简 CDP 客户端（Node 原生 WebSocket） ──────────────
class CDP {
  constructor(wsUrl) {
    this.id = 0
    this.pending = new Map()
    this.handlers = []
    this.ready = new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl)
      this.ws.onopen = () => resolve()
      this.ws.onerror = e => reject(new Error(`CDP WebSocket error: ${e.message || ''}`))
    })
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id) {
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
        }
      }
      else if (msg.method) {
        for (const h of this.handlers)
          h(msg.method, msg.params)
      }
    }
  }

  async send(method, params = {}) {
    await this.ready
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, handler) {
    this.handlers.push((m, p) => {
      if (m === method)
        handler(p)
    })
  }

  close() {
    try {
      this.ws.close()
    }
    catch { /* ignore */ }
  }
}

// ── 主流程 ──────────────────────────────────────────────
async function main() {
  const port = await findFreePort(startPort)
  console.log(`[cdp] Chrome: ${CHROME}`)
  console.log(`[cdp] 端口: ${port} | host: ${host} | 目标: ${targetUrl} | 监听 ${seconds}s | ${headed ? '有头' : 'headless'}`)

  const profileDir = join(ROOT, '.tmp', `cdp-profile-${port}`)
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    'about:blank',
  ]
  if (!headed)
    chromeArgs.unshift('--headless=new')
  const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore', windowsHide: true })

  let cdp
  try {
    // 等待 CDP endpoint 就绪
    let version
    for (let i = 0; i < 60; i++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
        break
      }
      catch { await sleep(250) }
    }
    if (!version)
      throw new Error(`CDP endpoint 未就绪 (${port})，Chrome 可能启动失败或端口被占`)

    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = list.find(t => t.type === 'page')
    if (!page)
      throw new Error('未找到 page target')

    cdp = new CDP(page.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    const cookies = parseCookies(cookieStr)
    await cdp.send('Network.setCookies', { cookies })
    console.log(`[cdp] 已注入 ${cookies.length} 个 cookie → .${host}`)

    const matched = []
    cdp.on('Network.responseReceived', ({ requestId, response }) => {
      if (isApi(response.url))
        matched.push({ requestId, url: response.url, status: response.status, mime: response.mimeType })
    })

    console.log(`[cdp] 导航: ${targetUrl}`)
    await cdp.send('Page.navigate', { url: targetUrl })
    await sleep(seconds * 1000)

    // 拉取响应体并落盘
    await mkdir(outDir, { recursive: true })
    const index = []
    let seq = 0
    for (const m of matched) {
      let body
      try {
        const r = await cdp.send('Network.getResponseBody', { requestId: m.requestId })
        body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body
      }
      catch { continue } // body 已丢失（如大文件/已卸载）

      let parsed
      try {
        parsed = JSON.parse(body)
      }
      catch {
        continue // 非 JSON 跳过
      }

      const ok = parsed.ok
      if (ok !== 1 && ok !== undefined && ok !== true)
        continue // 业务失败响应不入库
      seq += 1
      const name = fileName(m.url, seq)
      const fp = join(outDir, `${name}.json`)
      await writeFile(fp, body)
      const size = (body.length / 1024).toFixed(1)
      const okTag = ok === undefined ? `no-ok` : `ok:${ok}`
      console.log(`  ✓ [${String(seq).padStart(2, '0')}] ${m.status} ${okTag} ${size}K ${m.url}`)
      index.push({ file: `${name}.json`, status: m.status, ok, url: m.url, mime: m.mimeType, bytes: body.length })
    }

    if (!index.length) {
      console.warn('✗ 未捕获到有效 API 响应。可能原因: cookie 过期 / headless 被风控（加 --headed 重试）/ 目标页无 ajax')
    }
    else {
      await writeFile(join(outDir, '_index.json'), JSON.stringify(index, null, 2))
      console.log(`\n[done] 共 ${index.length} 个响应 → ${outDir}（原始未脱敏，入库前需脱敏）`)
    }
  }
  finally {
    cdp?.close()
    chrome.kill()
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
