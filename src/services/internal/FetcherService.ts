import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import type { IWeiboConfig } from '../../types/config'
import type { WeiboSDKErrorMeta, WeiboSDKFetchMeta, WeiboSDKHooks } from '~/types/hooks'
import type { IResource, IResourceType } from '~/types/resources'
import axios from 'axios'
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

export class FetcherService {
  private client: AxiosInstance
  private authService: AuthService
  private rateLimitService: RateLimitService
  private hooks?: WeiboSDKHooks
  private preflight?: () => Promise<void>
  public onFetched: (resource: IResourceType, data: IResource[typeof resource]) => void | Promise<void> = async () => {}

  constructor(
    private config: IWeiboConfig,
    deps?: {
      client?: AxiosInstance
      authService?: AuthService
      rateLimitService?: RateLimitService
      hooks?: WeiboSDKHooks
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
    )
    this.hooks = deps?.hooks ?? config.hooks
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
    },
  ): Promise<T> {
    const traceId = createTraceId()

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
        throw error
      }
    }

    await this.rateLimitService.acquire()
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
      throw mapped
    }
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
