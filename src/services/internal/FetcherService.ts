// src/services/internal/FetcherService.ts
import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import type { IWeiboConfig } from '../../types/config'
import axios from 'axios'
import { ConnectionTimeoutError, NetworkRequestError } from '../../models/errors/TransportError'

export interface IRequestResource {
  method: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
}

export class FetcherService {
  private client: AxiosInstance

  constructor(private config: IWeiboConfig) {
    this.client = axios.create({
      timeout: config.timeout || 30000,
      proxy: config.proxyUrl ? {
        // 简单处理代理字符串，实际可能需要更复杂的解析
        host: new URL(config.proxyUrl).hostname,
        port: Number.parseInt(new URL(config.proxyUrl).port),
      } : false,
    })

    this.setupInterceptors()
  }

  private setupInterceptors() {
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

  async fetch<T>(
    resource: IRequestResource,
    args?: Record<string, unknown>,
  ): Promise<T> {
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

  private handleError(error: unknown): never {
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
    throw error as Error
  }
}
