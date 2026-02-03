import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import type { IWeiboConfig } from '../../types/config'
import axios from 'axios'
import { ConnectionTimeoutError, NetworkRequestError } from '../../models/errors/TransportError'
import { AuthService } from './AuthService'
import { RateLimitService } from './RateLimitService'

export interface IRequestResource {
  method: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
}

export class FetcherService {
  private client: AxiosInstance
  private authService: AuthService
  private rateLimitService: RateLimitService

  constructor(private config: IWeiboConfig) {
    this.client = axios.create({
      timeout: config.timeout || 30000,
      proxy: config.proxyUrl
        ? {
            host: new URL(config.proxyUrl).hostname,
            port: Number.parseInt(new URL(config.proxyUrl).port),
          }
        : false,
    })
    this.authService = new AuthService(config)
    this.rateLimitService = new RateLimitService(
      config.maxConcurrent || 3,
      typeof config.delay === 'number' ? config.delay : 1000,
    )

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

  protected async fetch<T>(
    resource: IRequestResource,
    args?: Record<string, unknown>,
  ): Promise<T> {
    await this.rateLimitService.acquire()
    resource.headers = {
      'referer': 'https://weibo.com/',
      'host': 'weibo.com',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      ...this.authService.getAuthHeaders(),
      ...resource.headers
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
      this.handleError(error)
    }
  }

  private handleError(error: unknown | Error): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError
      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
        throw new ConnectionTimeoutError(axiosError.message, { code: axiosError.code })
      }
      throw new NetworkRequestError(axiosError.message, {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
      })
    }
    throw error
  }
}
