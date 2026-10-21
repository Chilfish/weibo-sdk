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

/**
 * 凭证解析上下文。
 *
 * `credential_id` 用于 telemetry / 错误 context；池化实现（未来外置插件）可据此做选择。
 */
export interface CredentialResolveContext {
  endpoint: string
  auth: EndpointAuth
  attempt: number
  traceId: string
}

/** 单次请求使用的凭证（不含 Cookie 明文标识）。 */
export interface Credential {
  /** 非敏感、稳定的凭证标识（telemetry / 错误 context 使用）。 */
  readonly id: string
  readonly mode: EndpointAuth
  /** 返回注入到请求头的字段（Cookie / X-XSRF-TOKEN）；`none` 返回空对象。 */
  getHeaders: () => Promise<Record<string, string>>
  /** 鉴权失败时刷新；返回 `true` 表示可以重试一次。 */
  refresh?: (reason: AuthFailureReason) => Promise<boolean>
}

/** 凭证解析端口；默认实现是单凭证，不做池化。 */
export interface CredentialResolver {
  resolve: (context: CredentialResolveContext) => Credential | Promise<Credential>
  /** 请求结果回报（池化实现用于冷却 / 失败计数）；默认实现忽略。 */
  report?: (context: {
    credential: Credential
    outcome: 'ok' | 'rate_limited' | 'auth_failed'
    error?: unknown
  }) => void
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

class CookieCredential implements Credential {
  readonly mode = 'cookie' as const
  readonly id: string

  constructor(private readonly authService: AuthService) {
    this.id = authService.getCredentialId()
  }

  async getHeaders(): Promise<Record<string, string>> {
    return this.authService.getAuthHeaders()
  }
}

class GuestCredential implements Credential {
  readonly mode = 'guest' as const
  readonly id = 'guest-primary'

  constructor(private readonly tokens: GuestTokenService) {}

  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.tokens.getToken()
    return { Cookie: token.cookie }
  }

  async refresh(): Promise<boolean> {
    return this.tokens.refresh()
  }
}

const NONE_CREDENTIAL: Credential = {
  id: 'none',
  mode: 'none',
  getHeaders: async () => ({}),
}

/** 默认解析器：所有非 `none` 端点使用同一份主凭证。 */
export class SingleCredentialResolver implements CredentialResolver {
  constructor(private readonly credential: Credential) {}

  resolve(context: CredentialResolveContext): Credential {
    return context.auth === 'none' ? NONE_CREDENTIAL : this.credential
  }
}

/** 鉴权运行时：由 SDK 门面创建一次，所有 Service 共享（guest token single-flight）。 */
export interface AuthContext {
  readonly mode: EffectiveAuthMode
  /** guest 模式下的 token 服务；cookie 模式为 `undefined`。 */
  readonly guestTokens?: GuestTokenService
  /** 凭证解析端口（默认单凭证）。 */
  readonly resolver: CredentialResolver
  /** 按端点声明 + 请求上下文选择凭证。 */
  getCredential: (auth: EndpointAuth, context?: Omit<CredentialResolveContext, 'auth'>) => Credential | Promise<Credential>
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
    const resolver = new SingleCredentialResolver(new CookieCredential(new AuthService(config)))
    return {
      mode,
      resolver,
      getCredential: (auth, context) => resolver.resolve({
        endpoint: context?.endpoint ?? '',
        attempt: context?.attempt ?? 1,
        traceId: context?.traceId ?? '',
        auth,
      }),
    }
  }

  const guestTokens = new GuestTokenService({
    issuer: config.guest?.issuer,
    presetToken: config.guest?.token,
    fetch: config.fetch,
    telemetry: deps.telemetry ?? config.telemetry,
  })
  const resolver = new SingleCredentialResolver(new GuestCredential(guestTokens))
  return {
    mode,
    guestTokens,
    resolver,
    getCredential: (auth, context) => resolver.resolve({
      endpoint: context?.endpoint ?? '',
      attempt: context?.attempt ?? 1,
      traceId: context?.traceId ?? '',
      auth,
    }),
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
  credentialId?: string,
): { auth_mode: EffectiveAuthMode, guest_refresh_count?: number, credential_id?: string } {
  return {
    auth_mode: mode,
    ...(guestRefreshCount === undefined ? {} : { guest_refresh_count: guestRefreshCount }),
    ...(credentialId === undefined ? {} : { credential_id: credentialId }),
  }
}

/** `guest_token_issue` / `guest_token_error` 的公共字段类型（供外部收集器断言）。 */
export type GuestTokenTelemetryEvent = Extract<TelemetryEvent, { event_name: 'guest_token_issue' | 'guest_token_error' }>
