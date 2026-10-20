import type { EndpointAuth } from './EndpointSpec'
import type { IWeiboConfig } from '~/types/config'
import type { TelemetryEvent, WeiboSDKTelemetry } from '~/types/telemetry'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { AuthService } from './AuthService'
import { GuestTokenService } from './GuestTokenService'

/** 鉴权失败原因（用于刷新决策与 telemetry）。 */
export type AuthFailureReason
  = | 'redirect_to_login'
    | 'visitor_entry'
    | 'ok_minus_100'
    | 'forbidden'
    | 'empty_object'
    | 'html'

/** 当前请求应使用的实际鉴权身份。 */
export type EffectiveAuthMode = 'cookie' | 'guest'

/** 请求头提供者。 */
export interface AuthProvider {
  readonly mode: EndpointAuth
  /** 返回注入到请求头的字段（Cookie / X-XSRF-TOKEN）；`none` 返回空对象。 */
  getHeaders: () => Promise<Record<string, string>>
  /** 鉴权失败时刷新；返回 `true` 表示可以重试一次。 */
  refresh?: (reason: AuthFailureReason) => Promise<boolean>
}

/**
 * 解析有效鉴权模式（不发起网络请求）。
 *
 * `auto` 只根据构造时是否提供 Cookie 决定，**不包含**「Cookie 失败后降级 guest」。
 *
 * @throws `InvalidConfigError`（`CONFIG_INVALID`）`auth: 'cookie'` 但没有 Cookie
 */
export function resolveAuthMode(config: Pick<IWeiboConfig, 'cookie' | 'auth'>): EffectiveAuthMode {
  if (config.auth === 'guest')
    return 'guest'

  const hasCookie = typeof config.cookie === 'string' && config.cookie.trim() !== ''
  if (config.auth === 'cookie') {
    if (!hasCookie) {
      throw new InvalidConfigError(
        'auth: "cookie" requires a non-empty cookie. Provide config.cookie or use auth: "guest".',
        { field: 'cookie', auth: 'cookie' },
      )
    }
    return 'cookie'
  }

  return hasCookie ? 'cookie' : 'guest'
}

class CookieAuthProvider implements AuthProvider {
  readonly mode = 'cookie' as const

  constructor(private readonly authService: AuthService) {}

  async getHeaders(): Promise<Record<string, string>> {
    return this.authService.getAuthHeaders()
  }
}

class GuestAuthProvider implements AuthProvider {
  readonly mode = 'guest' as const

  constructor(private readonly tokens: GuestTokenService) {}

  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.tokens.getToken()
    return { Cookie: token.cookie }
  }

  async refresh(): Promise<boolean> {
    return this.tokens.refresh()
  }
}

const NONE_PROVIDER: AuthProvider = {
  mode: 'none',
  getHeaders: async () => ({}),
}

/** 鉴权运行时：由 SDK 门面创建一次，所有 Service 共享（guest token single-flight）。 */
export interface AuthContext {
  readonly mode: EffectiveAuthMode
  /** guest 模式下的 token 服务；cookie 模式为 `undefined`。 */
  readonly guestTokens?: GuestTokenService
  /** 按端点声明选择 provider。 */
  getProvider: (auth: EndpointAuth) => AuthProvider
}

export interface AuthContextDeps {
  telemetry?: WeiboSDKTelemetry
}

/**
 * 创建鉴权运行时。
 *
 * - Cookie 模式：包装 `AuthService`，行为与旧版一致。
 * - Guest 模式：实例级 `GuestTokenService`，同一 SDK 内所有请求共享缓存与 single-flight。
 */
export function createAuthContext(
  config: IWeiboConfig,
  deps: AuthContextDeps = {},
): AuthContext {
  const mode = resolveAuthMode(config)

  if (mode === 'cookie') {
    const provider = new CookieAuthProvider(new AuthService(config))
    return {
      mode,
      getProvider: auth => (auth === 'none' ? NONE_PROVIDER : provider),
    }
  }

  const guestTokens = new GuestTokenService({
    issuer: config.guest?.issuer,
    presetToken: config.guest?.token,
    telemetry: deps.telemetry ?? config.telemetry,
  })
  const provider = new GuestAuthProvider(guestTokens)
  return {
    mode,
    guestTokens,
    getProvider: auth => (auth === 'none' ? NONE_PROVIDER : provider),
  }
}

/** 判断 telemetry / 错误上下文里的字符串是否为合法失败原因。 */
export function isAuthFailureReason(value: unknown): value is AuthFailureReason {
  return value === 'redirect_to_login'
    || value === 'visitor_entry'
    || value === 'ok_minus_100'
    || value === 'forbidden'
    || value === 'empty_object'
    || value === 'html'
}

/** 把鉴权状态扁平化成 telemetry 字段。 */
export function authTelemetryFields(
  mode: EffectiveAuthMode,
  guestRefreshCount?: number,
): { auth_mode: EffectiveAuthMode, guest_refresh_count?: number } {
  return {
    auth_mode: mode,
    ...(guestRefreshCount === undefined ? {} : { guest_refresh_count: guestRefreshCount }),
  }
}

/** `guest_token_issue` / `guest_token_error` 的公共字段类型（供外部收集器断言）。 */
export type GuestTokenTelemetryEvent = Extract<TelemetryEvent, { event_name: 'guest_token_issue' | 'guest_token_error' }>
