import { InvalidConfigError } from '../models/errors/ConfigError'

/**
 * Cookie 输入解析（SDK / CLI 共用）。
 *
 * `cookie` 参数既可以是一段 Cookie header 字符串，也可以是一个文件路径：
 * - header 串：`SUB=xxx; SUBP=xxx; XSRF-TOKEN=xxx`
 * - Netscape Cookie 文件（浏览器扩展 / curl `cookies.txt` 导出的 7 列格式）
 * - 内容为 header 串的文本文件（可带 `Cookie:` 前缀、多行）
 *
 * 设计约束：
 * - **浏览器安全**：不静态 import `node:fs`，通过 `process.getBuiltinModule('node:fs')`
 *   在 Node 下按需取用；浏览器（或没有该能力的环境）把输入原样返回。
 * - **纯函数拆分**：`parseNetscapeCookies` / `parseCookieHeaderContent` 可单测；
 *   只有 `resolveCookieInput` 触碰文件系统。
 * - **不泄露 Cookie**：抛错上下文只带路径与域名，不带 name/value。
 */

/** Netscape Cookie 文件的单行条目（7 列格式）。 */
export interface NetscapeCookie {
  /** Cookie 域名（已去掉 `#HttpOnly_` 前缀） */
  domain: string
  /** 是否包含子域名 */
  includeSubdomains: boolean
  /** Cookie path */
  path: string
  /** 是否仅 HTTPS */
  secure: boolean
  /** 过期时间（unix 秒；0 表示会话 Cookie） */
  expires: number
  /** Cookie 名 */
  name: string
  /** Cookie 值（可能包含 `=`） */
  value: string
}

export interface ResolveCookieOptions {
  /** 判定过期用的当前时间（毫秒），默认 `Date.now()`；测试注入固定值 */
  now?: number
}

/** 只保留微博相关域名的 Cookie，避免把浏览器里其它站点的 Cookie 发给微博。 */
const WEIBO_COOKIE_DOMAINS = ['weibo.com', 'weibo.cn', 'sina.com.cn'] as const

const HTTP_ONLY_PREFIX = '#HttpOnly_'

interface NodeFs {
  existsSync: (path: string) => boolean
  statSync: (path: string) => { isFile: () => boolean }
  readFileSync: (path: string, encoding: 'utf8') => string
}

type FileReadResult
  = | { status: 'ok', content: string }
    | { status: 'missing' }
    | { status: 'error', error: unknown }

/**
 * 同步获取 Node `fs` 模块（不产生静态 `node:fs` import）。
 *
 * 浏览器 / 用户脚本 / 受限沙箱里 `process` 可能不存在或没有 `getBuiltinModule`，
 * 此时返回 `undefined`，调用方退化为「只接受 header 串」。
 */
function getNodeFs(): NodeFs | undefined {
  const scope = globalThis as typeof globalThis & {
    process?: { getBuiltinModule?: (id: string) => unknown }
  }
  const proc = scope.process
  if (typeof proc?.getBuiltinModule !== 'function')
    return undefined

  try {
    return proc.getBuiltinModule('node:fs') as NodeFs | undefined
  }
  catch {
    return undefined
  }
}

function readCookieFile(fs: NodeFs, filePath: string): FileReadResult {
  try {
    if (!fs.existsSync(filePath))
      return { status: 'missing' }
    if (!fs.statSync(filePath).isFile())
      return { status: 'missing' }
    return { status: 'ok', content: fs.readFileSync(filePath, 'utf8') }
  }
  catch (error) {
    return { status: 'error', error }
  }
}

/**
 * 是否已经是 Cookie header 串（无需读文件）。
 *
 * 覆盖：`SUB=a; SUBP=b`、`Cookie: SUB=a`、单条 `SUB=a`。
 * 通过限制 name 部分不含路径分隔符，避免把 `C:\\tmp\\cookies=1.txt` 当成 header。
 */
function isInlineHeader(value: string): boolean {
  if (value.includes(';'))
    return true
  if (/^Cookie:\s*/i.test(value))
    return true
  return /^[^=\s;/\\]+=/.test(value)
}

/**
 * 是否像一个文件路径（不存在时给出明确错误，而不是当成 Cookie 原样发送）。
 */
function looksLikePath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value)
    || value.startsWith('/')
    || value.startsWith('\\')
    || value.startsWith('./')
    || value.startsWith('../')
    || value.startsWith('~')
    || /[\\/]/.test(value)
    || /\.(?:txt|cookies?|json|tsv)$/i.test(value)
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^Cookie:\s*/i, '')
    .trim()
    .replace(/;\s*$/, '')
}

/**
 * 解析 Netscape Cookie 文件内容（7 列 TSV）。
 *
 * 规则：
 * - `#HttpOnly_` 前缀是域名的修饰，不是注释；其余 `#` 开头行忽略
 * - 每行至少 7 列：domain / includeSubdomains / path / secure / expires / name / value
 * - `includeSubdomains` 必须是 TRUE/FALSE、`path` 必须以 `/` 开头，否则视为无效行
 * - value 可能包含 `=`，因此按 `\t` 切分后把剩余列拼回 value
 */
export function parseNetscapeCookies(content: string): NetscapeCookie[] {
  const cookies: NetscapeCookie[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine
    if (line.startsWith(HTTP_ONLY_PREFIX))
      line = line.slice(HTTP_ONLY_PREFIX.length)
    else if (line.startsWith('#'))
      continue

    const fields = line.split('\t')
    if (fields.length < 7)
      continue

    const [domain, includeSubdomains, cookiePath, secure, expires, name, ...valueParts] = fields
    if (!/^(?:true|false)$/i.test(includeSubdomains.trim()))
      continue
    if (!cookiePath.trim().startsWith('/'))
      continue
    if (!name.trim())
      continue

    cookies.push({
      domain: domain.trim(),
      includeSubdomains: includeSubdomains.trim().toLowerCase() === 'true',
      path: cookiePath.trim(),
      secure: secure.trim().toLowerCase() === 'true',
      expires: Number.parseInt(expires.trim(), 10) || 0,
      name: name.trim(),
      value: valueParts.join('\t'),
    })
  }

  return cookies
}

/**
 * 解析「内容本身就是 Cookie header 串」的文件。
 *
 * 支持 `Cookie:` 前缀、多行（每行一段 header）与 `#` 注释；无 `=` 的行会被忽略。
 * 返回 `k=v; k2=v2`；没有有效条目时返回空串。
 */
export function parseCookieHeaderContent(content: string): string {
  const pairs: string[] = []

  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^Cookie:\s*/i, '')
      .replace(/;\s*$/, '')

    if (!line || line.startsWith('#'))
      continue
    if (!line.includes('='))
      continue

    pairs.push(line)
  }

  return pairs.join('; ')
}

function isWeiboDomain(domain: string): boolean {
  const normalized = domain.toLowerCase().replace(/^\./, '')
  return WEIBO_COOKIE_DOMAINS.some(base => normalized === base || normalized.endsWith(`.${base}`))
}

function isExpired(cookie: NetscapeCookie, now: number): boolean {
  return cookie.expires > 0 && cookie.expires * 1000 < now
}

function toCookieHeader(cookies: NetscapeCookie[]): string {
  // 同名 Cookie（不同 path/域名）保留最后一条，与「后写覆盖」的直觉一致。
  const values = new Map<string, string>()
  for (const cookie of cookies)
    values.set(cookie.name, cookie.value)

  return [...values].map(([name, value]) => `${name}=${value}`).join('; ')
}

function parseCookieFileContent(content: string, sourcePath: string, now: number): string {
  const netscapeCookies = parseNetscapeCookies(content)

  if (netscapeCookies.length > 0) {
    const weiboCookies = netscapeCookies.filter(cookie => isWeiboDomain(cookie.domain))
    if (weiboCookies.length === 0) {
      const domains = [...new Set(netscapeCookies.map(cookie => cookie.domain))].slice(0, 10)
      throw new InvalidConfigError(
        `Cookie file contains no cookies for weibo.com: ${sourcePath}${
          domains.length > 0 ? ` (domains: ${domains.join(', ')})` : ''}`,
        { field: 'cookie', path: sourcePath, domains },
      )
    }

    const activeCookies = weiboCookies.filter(cookie => !isExpired(cookie, now))
    if (activeCookies.length === 0) {
      throw new InvalidConfigError(
        `All weibo cookies in the file are expired: ${sourcePath}`,
        { field: 'cookie', path: sourcePath },
      )
    }

    return toCookieHeader(activeCookies)
  }

  const header = parseCookieHeaderContent(content)
  if (!header) {
    throw new InvalidConfigError(
      `Cookie file contains no valid cookie entries: ${sourcePath}`,
      { field: 'cookie', path: sourcePath },
    )
  }

  return header
}

/**
 * 把 `cookie` 配置解析为可直接放进 `Cookie:` 请求头的字符串。
 *
 * - header 串 → 原样返回（仅去掉 `Cookie:` 前缀与结尾分号）
 * - 文件路径 → 读取并按 Netscape / header 串两种格式解析，仅保留微博域名 Cookie
 * - 浏览器等无 `node:fs` 的环境 → 原样返回（文件路径在浏览器不可用）
 *
 * @throws `InvalidConfigError`（`CONFIG_INVALID`）路径不存在 / 读取失败 / 文件中没有可用 Cookie
 */
export function resolveCookieInput(value: string, options: ResolveCookieOptions = {}): string {
  const raw = value.trim()
  if (!raw)
    return raw

  if (isInlineHeader(raw))
    return normalizeHeader(raw)

  if (!looksLikePath(raw))
    return raw

  const fs = getNodeFs()
  if (!fs)
    return raw

  const result = readCookieFile(fs, raw)
  if (result.status === 'missing') {
    throw new InvalidConfigError(
      `Cookie looks like a file path but the file does not exist: ${raw}`,
      { field: 'cookie', path: raw },
    )
  }
  if (result.status === 'error') {
    throw new InvalidConfigError(
      `Could not read cookie file: ${raw}`,
      { field: 'cookie', path: raw, cause: String(result.error) },
    )
  }

  return parseCookieFileContent(result.content, raw, options.now ?? Date.now())
}
