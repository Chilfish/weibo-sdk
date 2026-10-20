import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import type { ZodTypeAny } from 'zod'
import type { IWeiboConfig } from '../../types/config'
import type { EndpointArgsFromSchema, EndpointSpec } from './EndpointSpec'
import type { IRateLimitClock } from './RateLimitService'
import type { WeiboSDKErrorMeta, WeiboSDKFetchMeta, WeiboSDKHooks, WeiboSDKRawMeta } from '~/types/hooks'
import type { IResource, IResourceType } from '~/types/resources'
import type { TelemetryEvent, WeiboSDKTelemetry } from '~/types/telemetry'
import axios from 'axios'
import { WeiboAPINotOkError, WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { getMessage, getOk, isRecord } from '~/utils/response'
import { ConnectionTimeoutError, NetworkRequestError, RateLimitError } from '../../models/errors/TransportError'
import { AuthService } from './AuthService'
import { defaultClock, RateLimitService } from './RateLimitService'
import {
  classifyRetryableError,
  computeBackoffDelay,
  parseRetryAfter,
  readRetryAfterMs,
  resolveRetryPolicy,
} from './RetryPolicy'

export interface IRequestResource {
  method: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
}

let traceSeq = 0
function createTraceId(): string {
  traceSeq += 1
  return `${Date.now()}-${traceSeq}`
}

function getArgsKeys(args?: Record<string, unknown>): string | undefined {
  if (!args)
    return undefined
  const keys = Object.keys(args)
  if (keys.length === 0)
    return undefined
  keys.sort()
  return keys.join(',')
}

/** 微博风控状态码（HTTP 432）。 */
const RATE_LIMIT_STATUS = 432

/**
 * 从 axios 响应头里取一个头值（大小写不敏感）。
 *
 * axios 的 `headers` 可能是普通对象或 `AxiosHeaders` 实例，这里只做结构化读取。
 */
function getHeaderValue(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== 'object')
    return undefined
  const record = headers as Record<string, unknown>
  const lower = name.toLowerCase()
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower)
      return record[key]
  }
  return undefined
}

/** 取结构化错误 context 中的 HTTP 状态码（进 telemetry）。 */
function getErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof WeiboSDKError))
    return undefined
  const status = error.context?.status
  return typeof status === 'number' ? status : undefined
}

/**
 * 判断当前是否运行在浏览器/浏览器类环境（SPA、userscript、Electron renderer）。
 *
 * 不直接写 `typeof window` 是因为本仓库 tsconfig 的 `lib` 不含 DOM，
 * 这里通过 `globalThis` 做结构化判断，既能通过类型检查，也能覆盖 worker 场景。
 */
function isBrowserRuntime(): boolean {
  const scope = globalThis as typeof globalThis & { window?: { document?: unknown } }
  return typeof scope.window !== 'undefined' && typeof scope.window?.document !== 'undefined'
}

/**
 * 创建 axios 实例。
 *
 * `proxy` 是 Node-only 配置（仅 http/https adapter 使用）：浏览器（XHR/fetch adapter）会忽略它，
 * 且 `new URL(proxyUrl)` 在受限环境（userscript 沙箱、部分 worker）可能抛错。
 * 因此只在非浏览器环境注入 proxy，浏览器下退化为直连（由浏览器/宿主决定代理）。
 */
function createAxiosClient(config: IWeiboConfig): AxiosInstance {
  return axios.create({
    timeout: config.timeout || 30000,
  })
}

function toTelemetryErrorFields(error: unknown): Pick<
  Extract<TelemetryEvent, { event_name: 'request_error' }>,
  'error_name' | 'error_message' | 'error_code' | 'error_level' | 'error_retryable'
> {
  if (error instanceof WeiboSDKError) {
    return {
      error_name: error.name,
      error_message: error.message,
      error_code: error.code,
      error_level: error.level,
      error_retryable: error.retryable,
    }
  }

  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: error.message,
    }
  }

  return {
    error_name: typeof error,
  }
}

export class FetcherService {
  private client: AxiosInstance
  private authService: AuthService
  private rateLimitService: RateLimitService
  private hooks?: WeiboSDKHooks
  private telemetry?: WeiboSDKTelemetry
  private preflight?: () => Promise<void>
  /** 重试退避 / `Retry-After` HTTP date 解析用的时钟（可注入 FakeClock，保证离线测试确定性） */
  private clock: IRateLimitClock

  /**
   * @deprecated 请使用 `config.telemetry`（Wide Events）替代。
   */
  public onFetched: (resource: IResourceType, data: IResource[typeof resource]) => void | Promise<void> = async () => {}

  constructor(
    private config: IWeiboConfig,
    deps?: {
      client?: AxiosInstance
      authService?: AuthService
      rateLimitService?: RateLimitService
      hooks?: WeiboSDKHooks
      telemetry?: WeiboSDKTelemetry
      preflight?: () => Promise<void>
      /** 重试退避时钟（默认 `Date.now` / `setTimeout`）；测试注入 FakeClock */
      clock?: IRateLimitClock
    },
  ) {
    this.client = deps?.client ?? createAxiosClient(config)
    this.authService = deps?.authService ?? new AuthService(config)
    this.rateLimitService = deps?.rateLimitService ?? new RateLimitService(
      config.maxConcurrent || 3,
      typeof config.delay === 'number' ? config.delay : 1000,
      undefined,
      deps?.telemetry ?? config.telemetry,
    )
    this.hooks = deps?.hooks ?? config.hooks
    this.telemetry = deps?.telemetry ?? config.telemetry
    this.preflight = deps?.preflight
    this.clock = deps?.clock ?? defaultClock

    this.setupInterceptors()
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use((config) => {
      // Cookie 以 AuthService 解析后的结果为准（`config.cookie` 可能是文件路径）。
      const headers = this.authService.getAuthHeaders()
      config.headers.Cookie = headers.Cookie
      if (headers['X-XSRF-TOKEN'])
        config.headers['X-XSRF-TOKEN'] = headers['X-XSRF-TOKEN']
      return config
    })
  }

  protected newTraceId(): string {
    return createTraceId()
  }

  protected async fetch<T>(
    resource: IRequestResource,
    args?: Record<string, unknown>,
    options?: {
      skipPreflight?: boolean
      traceId?: string
      endpoint?: string
      resourceType?: IResourceType
    },
  ): Promise<T> {
    const traceId = options?.traceId ?? createTraceId()
    const startAt = Date.now()

    if (!options?.skipPreflight) {
      try {
        await this.preflight?.()
      }
      catch (error) {
        await this.emitError(error, {
          phase: 'preflight',
          request: resource,
          args,
          trace_id: traceId,
          timestamp: Date.now(),
        })

        await this.emitTelemetry({
          event_name: 'request_error',
          timestamp: Date.now(),
          trace_id: traceId,
          phase: 'preflight',
          method: resource.method,
          url: resource.url,
          endpoint: options?.endpoint,
          resource_type: options?.resourceType,
          duration_ms: Date.now() - startAt,
          ...toTelemetryErrorFields(error),
        })

        throw error
      }
    }

    await this.emitTelemetry({
      event_name: 'request_start',
      timestamp: Date.now(),
      trace_id: traceId,
      method: resource.method,
      url: resource.url,
      endpoint: options?.endpoint,
      resource_type: options?.resourceType,
      args_keys: getArgsKeys(args),
    })

    const policy = resolveRetryPolicy(this.config.retry)
    const maxAttempts = policy.retries + 1

    // 重试循环：用 for 而不是递归（见 postmortem「递归等待 = 深层 Promise 链」）
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.sendAttempt<T>(resource, args, traceId, attempt, options?.endpoint)
      }
      catch (rawError) {
        const error = this.mapError(rawError, attempt)
        const kind = classifyRetryableError(error)
        const delayMs = computeBackoffDelay({
          attempt,
          policy,
          retryAfterMs: readRetryAfterMs(error),
        })

        // 432 / 429：即使本次已不重试，也要暂停全局令牌桶，避免其他请求继续撞墙
        if (kind === 'rate_limit')
          this.pauseRateLimit(delayMs, traceId)

        const canRetry = kind !== undefined
          && policy.retryOn.includes(kind)
          && attempt < maxAttempts

        if (canRetry) {
          await this.emitTelemetry({
            event_name: 'request_retry',
            timestamp: Date.now(),
            trace_id: traceId,
            method: resource.method,
            url: resource.url,
            endpoint: options?.endpoint,
            resource_type: options?.resourceType,
            attempt,
            max_attempts: maxAttempts,
            delay_ms: delayMs,
            reason: kind,
            status: getErrorStatus(error),
            ...toTelemetryErrorFields(error),
          })

          await this.clock.sleep(delayMs)
          continue
        }

        await this.emitError(error, {
          phase: 'request',
          request: resource,
          args,
          trace_id: traceId,
          timestamp: Date.now(),
        })

        await this.emitTelemetry({
          event_name: 'request_error',
          timestamp: Date.now(),
          trace_id: traceId,
          phase: 'request',
          method: resource.method,
          url: resource.url,
          endpoint: options?.endpoint,
          resource_type: options?.resourceType,
          duration_ms: Date.now() - startAt,
          attempt,
          ...toTelemetryErrorFields(error),
        })

        throw error
      }
    }
  }

  /**
   * 单次尝试：取令牌 → 注入请求头 → 发请求。
   *
   * 每次重试都会重新 `acquire()`，因此 432 后的全局暂停对重试同样生效。
   */
  private async sendAttempt<T>(
    resource: IRequestResource,
    args: Record<string, unknown> | undefined,
    traceId: string,
    attempt: number,
    endpoint?: string,
  ): Promise<T> {
    await this.rateLimitService.acquire({ trace_id: traceId })
    // host 头从请求 URL 推导，避免跨 host 端点（如 m.weibo.cn）被强加 weibo.com 而 404
    resource.headers = {
      'referer': 'https://weibo.com/',
      'host': new URL(resource.url).host,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      ...this.authService.getAuthHeaders(),
      ...resource.headers,
    }

    const proxy = await this.resolveProxy(resource, traceId, attempt, endpoint)
    const config: AxiosRequestConfig = {
      method: resource.method,
      url: resource.url,
      headers: resource.headers,
      params: resource.method === 'GET' ? args : undefined,
      data: resource.method === 'POST' ? args : undefined,
      ...(proxy === undefined ? {} : { proxy }),
    }

    const response = await this.client.request<T>(config)
    return response.data
  }

  /**
   * 解析本次请求的代理配置。
   *
   * - 浏览器运行时忽略代理（由宿主决定）；
   * - `config.proxy` 支持静态 URL / 动态 Provider / `false`；
   * - 未配置时返回 `false`（显式直连，避免 Node 环境变量代理造成意外行为）。
   */
  private async resolveProxy(
    resource: IRequestResource,
    traceId: string,
    attempt: number,
    endpoint?: string,
  ): Promise<AxiosRequestConfig['proxy'] | undefined> {
    if (isBrowserRuntime())
      return undefined

    const input = this.config.proxy ?? this.config.proxyUrl
    if (input === undefined || input === false)
      return false

    let value: string | null | undefined | false
    if (typeof input === 'string') {
      value = input
    }
    else {
      value = await input.getProxy({
        url: resource.url,
        method: resource.method,
        endpoint,
        attempt,
        traceId,
      })
    }

    if (value === undefined || value === null || value === '' || value === false)
      return false

    let parsed: URL
    try {
      parsed = new URL(value)
    }
    catch {
      throw new InvalidConfigError(`Invalid proxy URL: ${value}`, {
        field: 'proxy',
        value,
      })
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new InvalidConfigError(`Proxy URL must use http(s): ${value}`, {
        field: 'proxy',
        value,
      })
    }

    return {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: parsed.port === ''
        ? (parsed.protocol === 'https:' ? 443 : 80)
        : Number.parseInt(parsed.port),
      ...(parsed.username === '' && parsed.password === ''
        ? {}
        : {
            auth: {
              username: decodeURIComponent(parsed.username),
              password: decodeURIComponent(parsed.password),
            },
          }),
    }
  }

  /**
   * 暂停全局令牌桶（432 / 429 风控协作）。
   *
   * 注入的 `RateLimitService` 可能不支持暂停（如测试替身），异常不得影响业务。
   */
  private pauseRateLimit(ms: number, traceId: string): void {
    try {
      this.rateLimitService.pause(ms, { trace_id: traceId, reason: 'rate_limit' })
    }
    catch {
      // ignore：限流实现可选支持暂停
    }
  }

  protected async request<
    TResource extends IResourceType,
    TArgsSchema extends ZodTypeAny | undefined,
  >(
    spec: EndpointSpec<TResource, TArgsSchema>,
    args: EndpointArgsFromSchema<TArgsSchema>,
    options?: {
      skipPreflight?: boolean
    },
  ): Promise<IResource[TResource]> {
    const traceId = this.newTraceId()
    const startAt = Date.now()
    const request = spec.buildResource(args)
    const argsRecord = (args ?? undefined) as unknown as Record<string, unknown> | undefined

    const raw = await this.fetch<unknown>(request, argsRecord, {
      ...options,
      traceId,
      endpoint: spec.endpoint,
      resourceType: spec.resourceType,
    })

    // P1-9：raw 必须在 okPolicy / Zod 校验前交付，保证失败响应也能被下游保存。
    await this.emitRaw(raw, {
      endpoint: spec.endpoint,
      resourceType: spec.resourceType,
      request,
      args: argsRecord,
      trace_id: traceId,
      timestamp: Date.now(),
    })

    const ok = getOk(raw)
    // 非 JSON 对象响应（HTML 登录页/风控页）不适用「ok !== 1」业务语义：跳过业务检查，
    // 让 schema 校验失败路径抛 ProtocolError（分类更准确，避免误报 API_NOT_OK）。
    if (spec.okPolicy?.mode === 'require_ok_1' && isRecord(raw)) {
      const okNumber = ok ?? 0
      const message = getMessage(raw)
      if (okNumber !== 1) {
        const notOkContext = {
          endpoint: spec.endpoint,
          ok: okNumber,
          message,
          args: argsRecord,
        }
        const looksLikeAuthFailure = okNumber === -100
          || /未登录|请登录|登录已过期|登录失效|login|passport/i.test(message ?? '')

        let error = spec.okPolicy.notOkError?.({
          endpoint: spec.endpoint,
          args: argsRecord,
          ok: okNumber,
          message,
          raw,
        })
        if (!error) {
          error = looksLikeAuthFailure
            ? new WeiboSessionExpiredError('Weibo session is missing or expired (ok != 1).', {
                ...notOkContext,
                hint: 'Cookie 可能已过期或未登录',
                next: '在浏览器打开 weibo.com 确认已登录，重新导出 Cookie 后更新 .env 的 WEIBO_COOKIE（或传 --cookie）',
              })
            : new WeiboAPINotOkError(`Weibo API returned ok != 1 (${spec.endpoint}).`, {
                ...notOkContext,
                raw,
              })
        }

        await this.emitError(error, {
          phase: 'response',
          endpoint: spec.endpoint,
          request,
          args: argsRecord,
          ok: okNumber,
          message,
          trace_id: traceId,
          timestamp: Date.now(),
        })

        await this.emitTelemetry({
          event_name: 'request_error',
          timestamp: Date.now(),
          trace_id: traceId,
          phase: 'response',
          method: request.method,
          url: request.url,
          endpoint: spec.endpoint,
          resource_type: spec.resourceType,
          duration_ms: Date.now() - startAt,
          ok: okNumber,
          message,
          ...toTelemetryErrorFields(error),
        })

        throw error
      }
    }

    const parsed = spec.schema.safeParse(raw)
    if (!parsed.success) {
      const isNonJson = !isRecord(raw)
      const rawText = typeof raw === 'string' ? raw : ''
      const looksLikeLoginPage = isNonJson
        && /<html/i.test(rawText)
        && /登录|login|passport/i.test(rawText)
      const error = new UnexpectedAPIResponseError(
        isNonJson
          ? `Weibo API response is not a JSON object (${spec.endpoint}). Likely login/challenge page or endpoint removed; raw was ${typeof raw}.`
          : `Weibo API response failed schema validation (${spec.endpoint}).`,
        {
          endpoint: spec.endpoint,
          args: argsRecord,
          raw: isNonJson && typeof raw === 'string' ? raw.slice(0, 200) : raw,
          zodIssues: isNonJson ? [] : parsed.error.issues,
          ...(isNonJson
            ? {
                hint: looksLikeLoginPage
                  ? '响应是 HTML 登录 / 风控页，而不是 JSON'
                  : '响应不是 JSON，端点可能已下线或需要登录态',
                next: looksLikeLoginPage
                  ? '在浏览器打开 weibo.com 确认已登录，重新导出 Cookie 后重试'
                  : '检查该端点是否仍存在；如为登录态问题，请更新 Cookie',
              }
            : {}),
        },
      )

      await this.emitError(error, {
        phase: 'parse',
        endpoint: spec.endpoint,
        request,
        args: argsRecord,
        trace_id: traceId,
        timestamp: Date.now(),
      })

      await this.emitTelemetry({
        event_name: 'request_error',
        timestamp: Date.now(),
        trace_id: traceId,
        phase: 'parse',
        method: request.method,
        url: request.url,
        endpoint: spec.endpoint,
        resource_type: spec.resourceType,
        duration_ms: Date.now() - startAt,
        ...toTelemetryErrorFields(error),
      })

      throw error
    }

    const data = parsed.data
    await this.emitFetched(spec.resourceType, data, { endpoint: spec.endpoint, request, args: argsRecord })

    await this.emitTelemetry({
      event_name: 'request_success',
      timestamp: Date.now(),
      trace_id: traceId,
      method: request.method,
      url: request.url,
      endpoint: spec.endpoint,
      resource_type: spec.resourceType,
      duration_ms: Date.now() - startAt,
      ok: ok ?? undefined,
    })
    return data
  }

  protected async emitFetched<T extends IResourceType>(
    resourceType: T,
    data: IResource[T],
    meta?: Omit<WeiboSDKFetchMeta, 'timestamp' | 'trace_id'>,
  ): Promise<void> {
    await this.onFetched(resourceType, data)
    await this.hooks?.onFetched?.(resourceType, data, {
      request: meta?.request,
      args: meta?.args,
      endpoint: meta?.endpoint,
      trace_id: createTraceId(),
      timestamp: Date.now(),
    })
  }

  protected async emitRaw(raw: unknown, meta: WeiboSDKRawMeta): Promise<void> {
    await this.hooks?.onRaw?.(raw, meta)
  }

  protected async emitError(
    error: unknown,
    meta: WeiboSDKErrorMeta,
  ): Promise<void> {
    await this.hooks?.onError?.(error, meta)
  }

  protected async emitTelemetry(event: TelemetryEvent & Record<string, string | number | boolean | null | undefined>): Promise<void> {
    try {
      await this.telemetry?.emit(event)
    }
    catch {
      // telemetry must not break SDK behavior
    }
  }

  private mapError(error: unknown | Error, attempt = 1): unknown {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError
      const status = axiosError.response?.status
      const retryAfterMs = parseRetryAfter(
        getHeaderValue(axiosError.response?.headers, 'retry-after'),
        this.clock.now(),
      )

      // 432（微博风控）/ 429（Too Many Requests）→ 结构化限流错误，可退避重试
      if (status === RATE_LIMIT_STATUS || status === 429) {
        const message = getMessage(axiosError.response?.data)
        return new RateLimitError(
          `Weibo API rate limited the request (HTTP ${status}).`,
          {
            status,
            attempt,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            ...(message === undefined ? {} : { message }),
          },
        )
      }

      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
        return new ConnectionTimeoutError(axiosError.message, {
          code: axiosError.code,
          ...(attempt > 1 ? { attempt } : {}),
        })
      }
      return new NetworkRequestError(axiosError.message, {
        status,
        data: axiosError.response?.data,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        ...(attempt > 1 ? { attempt } : {}),
      })
    }
    return error
  }
}
