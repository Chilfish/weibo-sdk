import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import type { IWeiboConfig } from '../../types/config'
import type { EndpointSpec } from './EndpointSpec'
import type { WeiboSDKErrorMeta, WeiboSDKFetchMeta, WeiboSDKHooks } from '~/types/hooks'
import type { IResource, IResourceType } from '~/types/resources'
import type { TelemetryEvent, WeiboSDKTelemetry } from '~/types/telemetry'
import axios from 'axios'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import { getMessage, getOk } from '~/utils/response'
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
    this.client = deps?.client ?? axios.create({
      timeout: config.timeout || 30000,
      proxy: config.proxyUrl
        ? {
            host: new URL(config.proxyUrl).hostname,
            port: Number.parseInt(new URL(config.proxyUrl).port),
          }
        : false,
    })
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
    resource.headers = {
      'referer': 'https://weibo.com/',
      'host': 'weibo.com',
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
    TArgs extends object | undefined,
  >(
    spec: EndpointSpec<TResource, TArgs>,
    args: TArgs,
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

    const ok = getOk(raw)
    if (spec.okPolicy?.mode === 'require_ok_1') {
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
      const error = new UnexpectedAPIResponseError(`Weibo API response failed schema validation (${spec.endpoint}).`, {
        endpoint: spec.endpoint,
        args: argsRecord,
        raw,
        zodIssues: parsed.error.issues,
      })

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
