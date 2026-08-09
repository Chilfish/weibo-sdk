import type { CDPConnection } from './cdp'
import type { CaptureItem, CaptureOptions } from './types'
import { existsSync } from 'node:fs'
// capture/src/capture.ts — 编排主流程：注入 cookie → 导航 → 收集 → 落盘
//
// 依赖注入（CaptureDeps）使全部 IO 可在测试中替换，离线验证编排逻辑。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from './cdp'
import { buildChromeArgs, findFreePort, spawnChrome, waitForEndpoint } from './chrome'
import { parseCookies } from './cookie'
import { isApi as defaultFilter, fileName } from './filter'

export interface CaptureDeps {
  findFreePort?: typeof findFreePort
  spawnChrome?: typeof spawnChrome
  connect?: typeof connect
  waitForEndpoint?: typeof waitForEndpoint
  getPageWsUrl?: (port: number) => Promise<string>
  writeFile?: typeof writeFile
  mkdir?: typeof mkdir
}

const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

function loadEnvCookie(): string {
  try {
    process.loadEnvFile()
  }
  catch {
    // .env 不存在时直接用环境变量
  }
  return process.env.WEIBO_COOKIE || ''
}

function resolveChromePath(): string {
  const p = process.env.CHROME_PATH || DEFAULT_CHROME
  if (!existsSync(p))
    throw new Error(`未找到 Chrome: ${p}，用 CHROME_PATH 环境变量指定路径`)
  return p
}

async function getPageWsUrl(port: number): Promise<string> {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = (list as Array<{ type: string, webSocketDebuggerUrl: string }>).find(t => t.type === 'page')
  if (!page)
    throw new Error('未找到 page target')
  return page.webSocketDebuggerUrl
}

/** 业务 ok 字段是否通过（响应无 ok 字段也视为有效捕获） */
function okPass(ok: unknown): boolean {
  return ok === undefined || ok === 1 || ok === true
}

export async function capture(options: CaptureOptions, deps: CaptureDeps = {}): Promise<CaptureItem[]> {
  const {
    findFreePort: findPort = findFreePort,
    spawnChrome: spawnFn = spawnChrome,
    connect: connectFn = connect,
    waitForEndpoint: wait = waitForEndpoint,
    getPageWsUrl: getWs = getPageWsUrl,
    writeFile: writeFn = writeFile,
    mkdir: mkdirFn = mkdir,
  } = deps

  const host = options.host ?? 'weibo.com'
  const seconds = options.seconds ?? 15
  const headless = options.headless ?? true
  const filter = options.filter ?? defaultFilter
  const cookieStr = options.cookie ?? loadEnvCookie()
  if (!cookieStr)
    throw new Error('WEIBO_COOKIE 缺失：请在 .env 配置或传 --cookie')
  const chromePath = options.chromePath ?? resolveChromePath()
  const targetUrl = options.url ?? (options.uid ? `https://weibo.com/u/${options.uid}` : 'https://weibo.com/')

  const port = await findPort(options.port ?? 9222)
  const profileDir = join(process.cwd(), '.tmp', `cdp-profile-${port}`)
  const chrome = spawnFn(chromePath, buildChromeArgs({ port, profileDir, headless }))

  let conn: CDPConnection | undefined
  try {
    await wait(port)
    conn = await connectFn(await getWs(port))
    const { cdp } = conn
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    await cdp.send('Network.setCookies', { cookies: parseCookies(cookieStr, `.${host}`) })

    const matched: Array<{ requestId: string, url: string, status: number, mime: string }> = []
    cdp.on('Network.responseReceived', (method, params) => {
      const response = params.response as { url?: string, status?: number, mimeType?: string } | undefined
      if (response?.url && filter(response.url))
        matched.push({ requestId: params.requestId, url: response.url, status: response.status ?? 0, mime: response.mimeType ?? '' })
    })

    await cdp.send('Page.navigate', { url: targetUrl })
    await new Promise(r => setTimeout(r, seconds * 1000))

    const items: CaptureItem[] = []
    let seq = 0
    for (const m of matched) {
      let body: string
      try {
        const r = await cdp.send('Network.getResponseBody', { requestId: m.requestId })
        body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body
      }
      catch {
        continue // body 已丢失（大文件/已卸载）
      }
      let json: unknown
      try {
        json = JSON.parse(body)
      }
      catch { continue } // 非 JSON 跳过

      const ok = (json as { ok?: unknown }).ok
      if (!okPass(ok))
        continue // 业务失败响应不入结果

      seq += 1
      const name = fileName(m.url, seq)
      let file: string | undefined
      if (options.outDir) {
        await mkdirFn(options.outDir, { recursive: true })
        await writeFn(join(options.outDir, `${name}.json`), body)
        file = `${name}.json`
      }
      items.push({ url: m.url, status: m.status, mime: m.mime, ok: ok as CaptureItem['ok'], body, json, file })
    }

    if (options.outDir && items.length) {
      const meta = items.map(it => ({ file: it.file, status: it.status, ok: it.ok, url: it.url, mime: it.mime, bytes: it.body.length }))
      await writeFn(join(options.outDir, '_index.json'), JSON.stringify(meta, null, 2))
    }
    return items
  }
  finally {
    conn?.close()
    chrome.kill()
  }
}
