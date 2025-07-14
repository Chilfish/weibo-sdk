/**
 * Core types for the weibo crawler SDK
 */

import type { FetcherConfig } from '@weibo-sdk/plugins'
import type { ApiRegistry } from './api-registry'

/**
 * Plugin interface that all plugins must implement
 */
export interface Plugin {
  /** Unique identifier for the plugin */
  name: string
  /** Plugin setup function called during crawler initialization */
  setup: (context: CrawlerContext) => void | Promise<void>
}

/**
 * Configuration options for the crawler
 */
export interface CrawlerConfig {
  /** Plugin instances to load */
  plugins?: Plugin[]
  /** Logger configuration */
  logger?: {
    level?: 'error' | 'warn' | 'info' | 'debug'
    format?: 'json' | 'simple'
  }
  /** HTTP client configuration */
  fetcher?: {
    retries?: number
  } & FetcherConfig
}

/**
 * Hook listener function signature
 */
export type Listener<T = any> = (payload: T, context: CrawlerContext) => void | Promise<void>

/**
 * Waterfall hook listener that can transform data
 */
export type WaterfallListener<T = any> = (payload: T, context: CrawlerContext) => T | Promise<T>

/**
 * API function signature for registered APIs
 */
export type ApiFunction = (...args: any[]) => any

/**
 * Logger interface
 */
export interface Logger {
  error: (message: string, meta?: object) => void
  warn: (message: string, meta?: object) => void
  info: (message: string, meta?: object) => void
  debug: (message: string, meta?: object) => void
}

/**
 * HTTP client interface
 */
export interface HttpClient {
  get: <T = any>(url: string, config?: any) => Promise<T>
  post: <T = any>(url: string, data?: any, config?: any) => Promise<T>
  put: <T = any>(url: string, data?: any, config?: any) => Promise<T>
  delete: <T = any>(url: string, config?: any) => Promise<T>
}

/**
 * Crawler context interface
 */
export interface CrawlerContext {
  /** Configuration object */
  readonly config: CrawlerConfig
  /** Hook system */
  readonly hooks: Hookable
  /** API registry */
  readonly apis: ApiRegistry
  /** Get a logger instance */
  getLogger: (namespace?: string) => Logger
}

/**
 * Hook system interface
 */
export interface Hookable {
  /** Register a hook listener */
  on: <T = any>(name: string, listener: Listener<T>) => void
  /** Call all listeners for a hook */
  call: <T = any>(name: string, payload?: T) => Promise<void>
  /** Call listeners in waterfall mode (data transformation) */
  waterfall: <T = any>(name: string, payload: T) => Promise<T>
}

/**
 * Error types for different scenarios
 */
export class SkipItemError extends Error {
  constructor(message: string, public readonly item: any) {
    super(message)
    this.name = 'SkipItemError'
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class NetworkError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'NetworkError'
  }
}
