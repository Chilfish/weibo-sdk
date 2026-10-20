import type { TelemetryEvent, TelemetryPrimitive, WeiboSDKTelemetry } from '~/types/telemetry'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { RateLimitError } from '~/models/errors/TransportError'

/** 访客 token 的发放来源。 */
export type GuestTokenSource = 'preset' | 'mobile' | 'desktop'

/** 访客 token 的适用范围。`pc` 只对 `weibo.com` 有效；`all` 同时覆盖 m 站。 */
export type GuestTokenScope = 'pc' | 'all'

/** 已发放的访客 token。 */
export interface GuestToken {
  /** 可直接放进 `Cookie:` 请求头的字符串（不含登录 Cookie）。 */
  cookie: string
  /** 发放时间（unix 毫秒）。 */
  issuedAt: number
  scope: GuestTokenScope
  source: GuestTokenSource
}

/** 访客 token 的只读状态（用于 `whoami --guest` / telemetry，不含 token 明文）。 */
export interface GuestTokenStatus {
  issuedAt: number
  scope: GuestTokenScope
  source: GuestTokenSource
}

/** 可注入的时钟（离线测试确定性）。 */
export interface GuestTokenClock {
  now: () => number
}

/** 最小 fetch 响应契约（避免依赖 DOM lib）。 */
export interface GuestFetchResponse {
  status: number
  ok: boolean
  headers: {
    get: (name: string) => string | null
    getSetCookie?: () => string[]
  }
  text: () => Promise<string>
}

/** 最小 fetch 契约（可注入 fake）。 */
export type GuestFetch = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    redirect?: 'follow' | 'error' | 'manual'
  },
) => Promise<GuestFetchResponse>

export interface GuestTokenServiceDeps {
  /** 注入 fetch（测试用）；默认使用 `globalThis.fetch`。 */
  fetch?: GuestFetch
  /** 注入时钟（测试用）；默认 `Date.now`。 */
  clock?: GuestTokenClock
  /** 发放方式（默认 `mobile`）。 */
  issuer?: 'mobile' | 'desktop' | 'auto'
  /** 预置访客 Cookie（`SUB=...; SUBP=...`）。 */
  presetToken?: string
  telemetry?: WeiboSDKTelemetry
}

export const MOBILE_USER_AGENT
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

export const DESKTOP_USER_AGENT
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'

const MOBILE_REFERER = 'https://m.weibo.cn/'
const WEIBOCN_FROM = 'WEIBOCN_FROM=1110003030'
const GEN_VISITOR_URL = 'https://visitor.passport.weibo.cn/visitor/genvisitor'
const INCARNATE_URL = 'https://visitor.passport.weibo.cn/visitor/visitor'
const DESKTOP_GEN_VISITOR_URL = 'https://passport.weibo.com/visitor/genvisitor2'

/**
 * 从 JSONP 响应体里提取 JSON 对象。
 *
 * 微博访客接口返回 `window.cb && cb({...})`；body 在限流/风控时可能没有 JSON。
 */
export function parseJsonp(body: string): unknown {
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < start)
    return undefined
  try {
    return JSON.parse(body.slice(start, end + 1))
  }
  catch {
    return undefined
  }
}

/** 从 `Set-Cookie` 数组（或合并后的字符串）里读取指定 Cookie。 */
export function readSetCookie(cookies: readonly string[], name: string): string | undefined {
  const joined = cookies.filter(Boolean).join(';')
  if (!joined)
    return undefined
  const match = joined.match(new RegExp(`(?:^|[;,]\\s*)${name}=([^;]+)`))
  return match?.[1]?.trim() || undefined
}

function readJsonpData(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return undefined
  const data = (body as { data?: unknown }).data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : undefined
}

function readTid(body: unknown): string | undefined {
  const tid = readJsonpData(body)?.tid
  return typeof tid === 'string' && tid !== '' ? tid : undefined
}

function readSub(body: unknown, cookieName: 'sub' | 'subp'): string | undefined {
  const value = readJsonpData(body)?.[cookieName]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function buildGuestCookie(sub: string, subp: string | undefined): string {
  return [`SUB=${sub}`, subp === undefined ? undefined : `SUBP=${subp}`, WEIBOCN_FROM]
    .filter((part): part is string => part !== undefined)
    .join('; ')
}

function hasSub(cookie: string): boolean {
  return /(?:^|;\s*)SUB=/i.test(cookie)
}

function defaultGuestFetch(): GuestFetch {
  const fetchImpl = (globalThis as typeof globalThis & { fetch?: unknown }).fetch
  if (typeof fetchImpl !== 'function') {
    throw new WeiboSessionExpiredError(
      'Guest mode requires a runtime with global fetch (Node.js 18+).',
      { auth_mode: 'guest', reason: 'fetch_unavailable' },
    )
  }
  return fetchImpl as GuestFetch
}

function responseError(status: number, url: string, body: string): WeiboSessionExpiredError {
  return new WeiboSessionExpiredError(
    `Guest token request failed (HTTP ${status}).`,
    {
      auth_mode: 'guest',
      reason: 'guest_token_issue',
      status,
      url,
      body: body.slice(0, 200),
      hint: '访客 token 接口可能限流或不可用',
      next: '稍后重试，或通过 config.guest.token 复用外部已发放的访客 Cookie',
    },
  )
}

/**
 * 移动端访客 token 服务。
 *
 * 设计约束（见 `docs/planning/research-guest-mode-2026-10-20.md` §2）：
 * - 只维护移动端 `genvisitor → incarnate` token；它同时覆盖 `weibo.com` 与 `m.weibo.cn`。
 * - 实例级缓存 + single-flight：并发请求共享同一次发放。
 * - 刷新失败保留旧 token，避免把原本可用的请求全部打挂。
 * - 不写磁盘；telemetry 不记录 token 明文。
 */
export class GuestTokenService {
  private readonly fetch: GuestFetch
  private readonly clock: GuestTokenClock
  private readonly issuer: 'mobile' | 'desktop' | 'auto'
  private readonly presetToken?: string
  private readonly telemetry?: WeiboSDKTelemetry
  private token?: GuestToken
  private tokenPromise?: Promise<GuestToken>
  private refreshPromise?: Promise<boolean>

  constructor(deps: GuestTokenServiceDeps = {}) {
    const presetToken = deps.presetToken?.trim() || undefined
    if (presetToken !== undefined && !hasSub(presetToken)) {
      throw new InvalidConfigError(
        'Guest token must contain a SUB cookie (e.g. "SUB=...; SUBP=...").',
        { field: 'guest.token' },
      )
    }
    this.fetch = deps.fetch ?? defaultGuestFetch()
    this.clock = deps.clock ?? { now: () => Date.now() }
    this.issuer = deps.issuer ?? 'mobile'
    this.presetToken = presetToken
    this.telemetry = deps.telemetry

    if (this.presetToken !== undefined) {
      this.token = {
        cookie: this.presetToken,
        issuedAt: this.clock.now(),
        scope: 'all',
        source: 'preset',
      }
    }
  }

  /** 返回缓存的 token；没有则触发放接口（single-flight）。 */
  async getToken(): Promise<GuestToken> {
    if (this.token)
      return this.token
    if (this.tokenPromise)
      return this.tokenPromise

    this.tokenPromise = this.issueWithFallback(false)
      .then((token) => {
        this.token = token
        return token
      })
      .finally(() => {
        this.tokenPromise = undefined
      })

    return this.tokenPromise
  }

  /**
   * 强制刷新 token。
   *
   * 并发调用共享同一个 Promise；刷新失败时保留旧 token 并返回 `false`。
   */
  async refresh(): Promise<boolean> {
    if (this.refreshPromise)
      return this.refreshPromise

    const previous = this.token
    this.refreshPromise = (async () => {
      try {
        this.token = await this.issueWithFallback(true)
        return true
      }
      catch {
        this.token = previous
        return false
      }
    })().finally(() => {
      this.refreshPromise = undefined
    })

    return this.refreshPromise
  }

  /** 当前 token 状态（不含 token 明文）；未发放时返回 `undefined`。 */
  getStatus(): GuestTokenStatus | undefined {
    if (!this.token)
      return undefined
    return {
      issuedAt: this.token.issuedAt,
      scope: this.token.scope,
      source: this.token.source,
    }
  }

  private async issueWithFallback(refreshed: boolean): Promise<GuestToken> {
    const startAt = this.clock.now()
    try {
      let token: GuestToken
      if (this.issuer === 'mobile') {
        token = await this.issueMobile()
      }
      else if (this.issuer === 'desktop') {
        token = await this.issueDesktop()
      }
      else {
        try {
          token = await this.issueMobile()
        }
        catch (mobileError) {
          try {
            token = await this.issueDesktop()
          }
          catch {
            throw mobileError
          }
        }
      }

      this.emit({
        event_name: 'guest_token_issue',
        timestamp: this.clock.now(),
        trace_id: this.traceId(),
        source: token.source,
        scope: token.scope,
        duration_ms: this.clock.now() - startAt,
        refreshed,
      })
      return token
    }
    catch (error) {
      this.emit({
        event_name: 'guest_token_error',
        timestamp: this.clock.now(),
        trace_id: this.traceId(),
        issuer: this.issuer,
        duration_ms: this.clock.now() - startAt,
        refreshed,
        error_name: error instanceof Error ? error.name : typeof error,
        error_message: error instanceof Error ? error.message : String(error),
        ...(error instanceof RateLimitError ? { status: error.context?.status as number } : {}),
      })
      throw error
    }
  }

  private async issueMobile(): Promise<GuestToken> {
    const gen = await this.fetch(GEN_VISITOR_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': MOBILE_USER_AGENT,
        'referer': MOBILE_REFERER,
      },
      body: 'cb=gen_callback&fp=%7B%22os%22%3A%221%22%7D',
    })
    const genBodyText = await gen.text()
    this.assertResponse(gen.status, GEN_VISITOR_URL, genBodyText)
    const tid = readTid(parseJsonp(genBodyText))
    if (!tid) {
      throw new WeiboSessionExpiredError('Guest token issuance failed: no tid returned.', {
        auth_mode: 'guest',
        reason: 'guest_token_issue',
        step: 'genvisitor',
        body: genBodyText.slice(0, 200),
      })
    }

    const incarnateUrl = `${INCARNATE_URL}?a=incarnate&t=${encodeURIComponent(tid)}`
      + '&w=2&c=095&gc=&cb=cross_domain&from=sinawap'
      + `&_rand=${Math.random()}`
    const inc = await this.fetch(incarnateUrl, {
      headers: {
        'user-agent': MOBILE_USER_AGENT,
        'referer': MOBILE_REFERER,
      },
    })
    const incBodyText = await inc.text()
    this.assertResponse(inc.status, INCARNATE_URL, incBodyText)
    const incBody = parseJsonp(incBodyText)
    const setCookies = inc.headers.getSetCookie?.() ?? [inc.headers.get('set-cookie') ?? '']
    const sub = readSetCookie(setCookies, 'SUB') ?? readSub(incBody, 'sub')
    const subp = readSetCookie(setCookies, 'SUBP') ?? readSub(incBody, 'subp')
    if (!sub) {
      throw new WeiboSessionExpiredError('Guest token issuance failed: no SUB cookie returned.', {
        auth_mode: 'guest',
        reason: 'guest_token_issue',
        step: 'incarnate',
        body: incBodyText.slice(0, 200),
      })
    }

    return {
      cookie: buildGuestCookie(sub, subp),
      issuedAt: this.clock.now(),
      scope: 'all',
      source: 'mobile',
    }
  }

  private async issueDesktop(): Promise<GuestToken> {
    const response = await this.fetch(DESKTOP_GEN_VISITOR_URL, {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data',
        'user-agent': DESKTOP_USER_AGENT,
        'referer': 'https://weibo.com/',
        'origin': 'https://weibo.com',
      },
      body: 'cb=visitor_gray_callback',
    })
    const text = await response.text()
    this.assertResponse(response.status, DESKTOP_GEN_VISITOR_URL, text)
    const body = parseJsonp(text)
    const setCookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']
    const sub = readSetCookie(setCookies, 'SUB') ?? readSub(body, 'sub')
    const subp = readSetCookie(setCookies, 'SUBP') ?? readSub(body, 'subp')
    if (!sub) {
      throw new WeiboSessionExpiredError('Guest token issuance failed: no SUB cookie returned.', {
        auth_mode: 'guest',
        reason: 'guest_token_issue',
        step: 'genvisitor2',
        body: text.slice(0, 200),
      })
    }
    return {
      cookie: buildGuestCookie(sub, subp),
      issuedAt: this.clock.now(),
      scope: 'pc',
      source: 'desktop',
    }
  }

  private assertResponse(status: number, url: string, body: string): void {
    if (status === 432 || status === 429) {
      throw new RateLimitError(`Guest token endpoint rate limited (HTTP ${status}).`, {
        status,
        url,
        body: body.slice(0, 200),
      })
    }
    if (status < 200 || status >= 300)
      throw responseError(status, url, body)
  }

  private emit(event: TelemetryEvent & Record<string, TelemetryPrimitive | undefined>): void {
    if (!this.telemetry)
      return
    try {
      void Promise.resolve(this.telemetry.emit(event)).catch(() => {})
    }
    catch {
      // telemetry must not break token issuance
    }
  }

  private traceId(): string {
    return `guest-${this.clock.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}
