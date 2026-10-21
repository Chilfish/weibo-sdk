#!/usr/bin/env node
/**
 * 浏览器构建产物 smoke 测试（P2-1）
 *
 * 校验内容：
 * 1. `package.json#exports` 的 `.` / `./cli` / `./browser` 均指向真实产物。
 * 2. Node 构建（`dist/index.mjs`）仍可导入并构造 SDK（回归，不发请求）。
 * 3. `dist/browser.mjs` 在真实 Chromium 中可以直接 `import`（无 bare specifier、无 Node-only 模块），
 *    并断言 `new WeiboSDK({ cookie: 'x' })` 构造不抛错、不产生网络请求。
 * 4. 浏览器环境下 `proxy` 不会注入 axios `proxy`（构造不抛错，退化为直连）。
 *
 * 用法：
 *   node scripts/browser-smoke.mjs               # 起临时静态服务器 + agent-browser 跑真实 Chromium
 *   node scripts/browser-smoke.mjs --no-browser  # 只做 Node 侧检查，打印可手动打开的 URL
 *   node scripts/browser-smoke.mjs --keep-open   # 跑完不关闭 agent-browser 会话（调试用）
 *
 * 环境变量：AGENT_BROWSER_BIN（可执行文件路径）、AGENT_BROWSER_SESSION（隔离会话名）。
 *
 * 说明：脚本只用 Node 内置模块 + 全局 `agent-browser` CLI；临时 HTML 由内存静态服务器提供，
 * agent-browser 的 stdout/stderr 落在 `.cache/browser-smoke/`（已 gitignore）。
 */

import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = path.join(ROOT, '.cache', 'browser-smoke')
const NODE_ENTRY = path.join(ROOT, 'dist/index.mjs')
const BROWSER_BUNDLE = path.join(ROOT, 'dist/browser.mjs')
const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN || 'agent-browser'
// 独立 session，避免影响其它 agent / 人工正在使用的浏览器。
const SESSION = process.env.AGENT_BROWSER_SESSION || 'weibo-sdk-browser-smoke'
const withBrowser = !process.argv.includes('--no-browser')
const keepOpen = process.argv.includes('--keep-open')
const isWindows = process.platform === 'win32'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>SMOKE:PENDING</title>
</head>
<body>
  <pre id="out">running…</pre>
  <script type="module">
    const result = { status: 'running', ok: false, checks: [], errors: [] }

    function expect(name, fn) {
      try {
        const value = fn()
        result.checks.push({ name, pass: value === true, detail: String(value) })
      }
      catch (error) {
        const detail = String((error && error.stack) || error)
        result.checks.push({ name, pass: false, detail })
        result.errors.push(detail)
      }
    }

    try {
      const mod = await import('/dist/browser.mjs')

      expect('browser bundle exposes WeiboSDK', () => typeof mod.WeiboSDK === 'function')
      expect('browser bundle exposes VERSION', () => typeof mod.VERSION === 'string')
      expect('browser bundle exposes Tweet/User models', () => typeof mod.Tweet === 'function' && typeof mod.User === 'function')

      let sdk
      expect('new WeiboSDK({ cookie: "x" }) does not throw', () => {
        sdk = new mod.WeiboSDK({ cookie: 'x' })
        return sdk instanceof mod.WeiboSDK
      })
      expect('services are mounted', () => Boolean(
        sdk && sdk.users && sdk.tweets && sdk.followings
        && sdk.favorites && sdk.trends && sdk.search && sdk.archive,
      ))
      expect('selfCheck() is available', () => typeof sdk.selfCheck === 'function')

      // 浏览器里 proxy 必须被忽略（不注入 axios proxy），且构造不得因 URL 解析 / Node-only 逻辑抛错。
      expect('new WeiboSDK({ cookie, proxy }) does not throw in browser', () => {
        const scoped = new mod.WeiboSDK({ cookie: 'x', proxy: 'http://127.0.0.1:7890' })
        return scoped instanceof mod.WeiboSDK
      })

      // 构造过程不得发起任何网络请求（尤其是 weibo.com）。
      const requests = performance.getEntriesByType('resource').map(entry => String(entry.name))
      expect('no weibo network requests during construction', () => requests.every(url => !url.includes('weibo')))
    }
    catch (error) {
      const detail = String((error && error.stack) || error)
      result.checks.push({ name: 'import("/dist/browser.mjs")', pass: false, detail })
      result.errors.push(detail)
    }

    result.ok = result.checks.length > 0 && result.checks.every(check => check.pass)
    result.status = result.ok ? 'PASS' : 'FAIL'
    globalThis.__SMOKE = result
    document.title = 'SMOKE:' + result.status
    document.getElementById('out').textContent = JSON.stringify(result, null, 2)
  </script>
</body>
</html>
`

function log(message) {
  process.stdout.write(`${message}\n`)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

/**
 * 解析 agent-browser 可执行文件。
 *
 * Windows 上 npm 全局安装的 `agent-browser` 是 .cmd 批处理包装（内部再调用 .exe）；
 * 用 `shell: true` spawn 会把参数拼进 cmd 命令行（`<`/`>`/`&` 会炸），
 * 这里直接在 PATH 里找 .exe，或解析 .cmd 里的真实 .exe，做到无 shell 执行。
 */
function resolveAgentBrowser() {
  if (process.env.AGENT_BROWSER_BIN)
    return { command: process.env.AGENT_BROWSER_BIN }
  if (!isWindows)
    return { command: AGENT_BROWSER_BIN }

  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)

  for (const dir of dirs) {
    const exe = path.join(dir, `${AGENT_BROWSER_BIN}.exe`)
    if (existsSync(exe))
      return { command: exe }
  }

  for (const dir of dirs) {
    const shim = path.join(dir, `${AGENT_BROWSER_BIN}.cmd`)
    if (!existsSync(shim))
      continue
    try {
      const match = readFileSync(shim, 'utf8').match(/"([^"]+\.exe)"/i)
      if (!match)
        continue
      const target = path.resolve(dir, match[1].replace(/%~dp0/gi, ''))
      if (existsSync(target))
        return { command: target }
    }
    catch {}
  }

  return { command: AGENT_BROWSER_BIN, shell: true }
}

const AGENT_BROWSER = resolveAgentBrowser()

/**
 * 调用 agent-browser（异步）。
 *
 * 两个坑：
 * 1. 必须把 stdout/stderr 重定向到文件而不是 pipe —— agent-browser 会留一个 daemon 进程
 *    继承这些 fd，pipe 永远等不到 EOF。
 * 2. 必须异步 spawn —— 同步阻塞会把本进程里的静态 HTTP 服务器卡死，
 *    `open` 期间浏览器取不到页面，CLI 会以 "no response came back" 超时失败。
 */
function runAgentBrowser(args) {
  return new Promise((resolve) => {
    mkdirSync(CACHE_DIR, { recursive: true })
    const outFile = path.join(CACHE_DIR, 'agent-browser.out.log')
    const errFile = path.join(CACHE_DIR, 'agent-browser.err.log')
    const outFd = openSync(outFile, 'w')
    const errFd = openSync(errFile, 'w')

    const readLog = (file) => {
      try {
        return readFileSync(file, 'utf8').trim()
      }
      catch {
        return ''
      }
    }

    let settled = false
    let timer
    const child = spawn(AGENT_BROWSER.command, ['--session', SESSION, ...args], {
      cwd: ROOT,
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
      shell: Boolean(AGENT_BROWSER.shell),
    })

    const finish = (status, error) => {
      if (settled)
        return
      settled = true
      clearTimeout(timer)
      closeSync(outFd)
      closeSync(errFd)
      resolve({
        ok: status === 0,
        status,
        stdout: readLog(outFile),
        stderr: readLog(errFile),
        error,
      })
    }

    timer = setTimeout(() => {
      try {
        child.kill()
      }
      catch {}
      finish(null, new Error('agent-browser timed out after 120s'))
    }, 120_000)

    child.on('error', error => finish(null, error))
    child.on('exit', code => finish(code))
  })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function runNodeChecks() {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
  const checks = []

  const push = (name, fn) => {
    try {
      const value = fn()
      checks.push({ name, pass: value === true, detail: String(value) })
    }
    catch (error) {
      checks.push({ name, pass: false, detail: String((error && error.stack) || error) })
    }
  }

  push('package.json#exports["."] -> ./dist/index.mjs', () => pkg.exports['.'] === './dist/index.mjs')
  push('package.json#exports["./cli"] -> ./dist/cli.mjs', () => pkg.exports['./cli'] === './dist/cli.mjs')
  push('package.json#exports["./browser"] -> ./dist/browser.mjs', () => {
    const entry = pkg.exports['./browser']
    return Boolean(entry) && entry.default === './dist/browser.mjs' && entry.types === './dist/index.d.mts'
  })

  await import(pathToFileURL(NODE_ENTRY).href).then((mod) => {
    push('node build exposes WeiboSDK', () => typeof mod.WeiboSDK === 'function')
    push('node build: new WeiboSDK({ cookie: "x" }) does not throw', () => {
      const sdk = new mod.WeiboSDK({ cookie: 'x' })
      return sdk instanceof mod.WeiboSDK && Boolean(sdk.tweets)
    })
    // Node 下 proxy 必须仍然被接受（构造不抛错），代理行为保持原样。
    push('node build: new WeiboSDK({ cookie, proxy }) does not throw', () => {
      const sdk = new mod.WeiboSDK({ cookie: 'x', proxy: 'http://127.0.0.1:7890' })
      return sdk instanceof mod.WeiboSDK
    })
  }).catch((error) => {
    push('import dist/index.mjs', () => {
      throw error
    })
  })

  return checks
}

function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    try {
      if (url.pathname === '/' || url.pathname === '/__smoke__.html') {
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
        res.end(HTML)
        return
      }
      if (url.pathname.startsWith('/dist/')) {
        const filePath = path.join(ROOT, url.pathname)
        if (!filePath.startsWith(path.join(ROOT, 'dist'))) {
          res.writeHead(403).end('forbidden')
          return
        }
        const body = await readFile(filePath)
        res.writeHead(200, {
          'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
          'cache-control': 'no-store',
        })
        res.end(body)
        return
      }
      res.writeHead(404).end('not found')
    }
    catch {
      res.writeHead(404).end('not found')
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port })
    })
  })
}

async function runBrowserSmoke(port) {
  const pageUrl = `http://127.0.0.1:${port}/__smoke__.html`

  const opened = await runAgentBrowser(['open', pageUrl])
  if (!opened.ok) {
    fail(`agent-browser open failed (status=${opened.status ?? opened.error?.code ?? '?'})\n${opened.stderr || opened.stdout}`)
    return
  }

  let title = ''
  for (let attempt = 0; attempt < 40; attempt++) {
    const probe = await runAgentBrowser(['get', 'title'])
    title = probe.stdout.replace(/^"|"$/g, '')
    if (title === 'SMOKE:PASS' || title === 'SMOKE:FAIL')
      break
    await sleep(500)
  }

  const detail = await runAgentBrowser(['get', 'text', '#out'])
  if (detail.stdout)
    log(detail.stdout)

  if (!keepOpen)
    await runAgentBrowser(['close'])

  if (title === 'SMOKE:PASS')
    log('✔ browser smoke: PASS')
  else
    fail(`✖ browser smoke: ${title ? `page reported ${title}` : 'TIMEOUT (page never reported SMOKE:PASS/FAIL)'}`)
}

async function main() {
  log(`▸ repo: ${ROOT}`)
  log('▸ node / package.json exports checks')

  const nodeChecks = await runNodeChecks()
  for (const check of nodeChecks)
    log(`  ${check.pass ? '✔' : '✖'} ${check.name}${check.pass ? '' : ` — ${check.detail}`}`)

  if (!nodeChecks.every(check => check.pass))
    fail('✖ node-side checks failed')

  if (!existsSync(BROWSER_BUNDLE))
    throw new Error(`missing ${BROWSER_BUNDLE} — run \`pnpm run build\` first`)

  const { server, port } = await startServer()
  const pageUrl = `http://127.0.0.1:${port}/__smoke__.html`
  log(`▸ static server: ${pageUrl}`)

  if (!withBrowser) {
    log('▸ --no-browser: 手动打开上面的 URL，页面标题会变成 SMOKE:PASS / SMOKE:FAIL，')
    log(`  详情见 #out；也可以执行：agent-browser open "${pageUrl}"`)
    if (!keepOpen)
      server.close()
    return
  }

  try {
    await runBrowserSmoke(port)
  }
  finally {
    server.close()
  }
}

main().catch((error) => {
  fail(`✖ browser smoke crashed: ${String((error && error.stack) || error)}`)
})
