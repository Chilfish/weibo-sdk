import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import type { ZodTypeAny } from 'zod'
import type { IWeiboConfig } from '../../types/config'
import type { EndpointArgsFromSchema, EndpointSpec } from './EndpointSpec'
import type { WeiboSDKErrorMeta, WeiboSDKFetchMeta, WeiboSDKHooks, WeiboSDKRawMeta } from '~/types/hooks'
import type { IResource, IResourceType } from '~/types/resources'
import type { TelemetryEvent, WeiboSDKTelemetry } from '~/types/telemetry'
import axios from 'axios'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { getMessage, getOk, isRecord } from '~/utils/response'
import { ConnectionTimeoutError, NetworkRequestError } from '../../models/errors/TransportError'
import { AuthService } from './AuthService'
import { RateLimitService } from './RateLimitService'

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
  const options: AxiosRequestConfig = {
    timeout: config.timeout || 30000,
  }

  if (!isBrowserRuntime()) {
    options.proxy = config.proxyUrl
      ? {
          host: new URL(config.proxyUrl).hostname,
          port: Number.parseInt(new URL(config.proxyUrl).port),
        }
      : false
  }

  return axios.create(options)
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

    this.setupInterceptors()
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use((config) => {
      // 在这里注入 Cookie 和 XSRF Token
      if (this.config.cookie) {
        config.headers.Cookie = this.config.cookie
      }
      if (this.config.xsrfToken) {
        config.headers['X-XSRF-TOKEN'] = this.config.xsrfToken
      }
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

    await this.rateLimitService.acquire({ trace_id: traceId })
    // host 头从请求 URL 推导，避免跨 host 端点（如 m.weibo.cn）被强加 weibo.com 而 404
    resource.headers = {
      'referer': 'https://weibo.com/',
      'host': new URL(resource.url).host,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      ...this.authService.getAuthHeaders(),
      ...resource.headers,
    }

    const config: AxiosRequestConfig = {
      method: resource.method,
      url: resource.url,
      headers: resource.headers,
      params: resource.method === 'GET' ? args : undefined,
      data: resource.method === 'POST' ? args : undefined,
    }

    try {
      const response = await this.client.request<T>(config)
      return response.data
    }
    catch (error) {
      const mapped = this.mapError(error)
      await this.emitError(mapped, {
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
        ...toTelemetryErrorFields(mapped),
      })

      throw mapped
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
        const error = spec.okPolicy.notOkError?.({
          endpoint: spec.endpoint,
          args: argsRecord,
          ok: okNumber,
          message,
          raw,
        }) ?? new WeiboAPINotOkError(`Weibo API returned ok != 1 (${spec.endpoint}).`, {
          endpoint: spec.endpoint,
          ok: okNumber,
          message,
          args: argsRecord,
          raw,
        })

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
      const error = new UnexpectedAPIResponseError(
        isNonJson
          ? `Weibo API response is not a JSON object (${spec.endpoint}). Likely login/challenge page or endpoint removed; raw was ${typeof raw}.`
          : `Weibo API response failed schema validation (${spec.endpoint}).`,
        {
          endpoint: spec.endpoint,
          args: argsRecord,
          raw: isNonJson && typeof raw === 'string' ? raw.slice(0, 200) : raw,
          zodIssues: isNonJson ? [] : parsed.error.issues,
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

  private mapError(error: unknown | Error): unknown {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError
      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
        return new ConnectionTimeoutError(axiosError.message, { code: axiosError.code })
      }
      return new NetworkRequestError(axiosError.message, {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
      })
    }
    return error
  }
}
