import type { ICrawlerContext, Plugin } from '@weibo-sdk/core'
import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import axios from 'axios'

/**
 * Fetcher plugin configuration
 */
export interface FetcherConfig {
  cookies?: string

  /** Base URL for requests */
  baseURL?: string
  /** Request timeout in milliseconds */
  timeout?: number
  /** Default headers */
  headers?: Record<string, string>
}

/**
 * Simple HTTP fetcher implementation
 */
class Fetcher {
  private client: AxiosInstance
  private logger

  constructor(private context: ICrawlerContext) {
    this.logger = context.getLogger('core:fetcher')
    const config = context.config.fetcher || {}

    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': config.cookies || '',
        ...config.headers,
      },
    })
  }

  /**
   * Perform HTTP GET request
   */
  public async fetch(url: string, options: AxiosRequestConfig = {}): Promise<any> {
    this.logger.debug('Fetching URL', { url })

    try {
      const response = await this.client.get(url, options)
      this.logger.debug('Fetch successful', {
        url,
        status: response.status,
      })
      const data = response.data

      await this.context.hooks.call('core:fetch-raw', {
        url,
        data,
      })

      return data
    }
    catch (error: any) {
      this.logger.error('Fetch failed', { url, error: error.message })
      throw error
    }
  }

  /**
   * Set authentication cookie
   */
  public setCookie(cookie: string): void {
    this.client.defaults.headers.Cookie = cookie
    this.logger.debug('Cookie updated')
  }

  /**
   * Update headers
   */
  public setHeaders(headers: Record<string, string>): void {
    Object.assign(this.client.defaults.headers, headers)
    this.logger.debug('Headers updated', { headers })
  }
}

/**
 * Create fetcher plugin
 * @param config Fetcher configuration
 * @returns Plugin instance
 */
export function createFetcherPlugin(): Plugin {
  return {
    name: 'core:fetcher',
    setup: (context) => {
      const fetcher = new Fetcher(context)

      // Register fetcher API
      context.apis.register('fetcher', fetcher.fetch.bind(fetcher))
      context.apis.register('fetcher:setCookie', fetcher.setCookie.bind(fetcher))
      context.apis.register('fetcher:setHeaders', fetcher.setHeaders.bind(fetcher))
    },
  }
}

export interface FetcherApis {
  'fetcher': Fetcher['fetch']
  'fetcher:setCookie': Fetcher['setCookie']
  'fetcher:setHeaders': Fetcher['setHeaders']
}
