import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import type { HttpResponse, IHttpClient, RequestOptions } from '../types/core'
import axios from 'axios'

export class AxiosHttpClient implements IHttpClient {
  private axiosInstance: AxiosInstance

  constructor(defaultHeaders: Record<string, string> = {}) {
    this.axiosInstance = axios.create({
      headers: defaultHeaders,
      validateStatus: status => status >= 200 && status < 300, // 默认只允许 2xx
    })

    // 可以在这里添加全局拦截器
    this.axiosInstance.interceptors.response.use(
      response => response,
      (error) => {
        // 统一错误处理，保留 HTTP 状态码信息
        if (error.response) {
          error.message = `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
        }
        return Promise.reject(error)
      },
    )
  }

  public get instance(): AxiosInstance {
    return this.axiosInstance
  }

  async get<T = any>(url: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'GET' })
  }

  async post<T = any>(url: string, body?: any, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'POST', data: body })
  }

  private async request<T>(url: string, options: RequestOptions & AxiosRequestConfig): Promise<HttpResponse<T>> {
    // 转换我们的 RequestOptions 到 AxiosRequestConfig
    const config: AxiosRequestConfig = {
      url,
      method: options.method,
      headers: options.headers || {},
      params: options.params,
      timeout: options.timeout || 10000,
      data: options.data,
      responseType: options.responseType === 'text' ? 'text' : 'json', // 简化处理
    }

    // 处理代理 (Axios 格式)
    if (options.proxy) {
      // 实际生产需要解析 proxy string (user:pass@host:port) 为对象
      // 这里暂留坑位，建议使用 https-proxy-agent
      // config.httpsAgent = ...
    }

    const response = await this.axiosInstance.request<T>(config)

    return {
      data: response.data,
      status: response.status,
      headers: response.headers as Record<string, string>,
    }
  }
}
