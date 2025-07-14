import type { FetcherApis, MapperApis } from '@weibo-sdk/plugins'
import type { ApiFunction, CrawlerContext } from './types'

export type ApiFunctions = FetcherApis & MapperApis

export type ApiFunctionNames = keyof ApiFunctions

/**
 * API registry interface
 */
export interface ApiRegistry {
  /** Register an API function */
  register: <T extends ApiFunction>(name: string, fn: T) => void
  /** Get a registered API function */
  get: <K extends ApiFunctionNames>(name: K) => ApiFunctions[K]
  /** Wrap an existing API with middleware */
  wrap: <K extends ApiFunctionNames>(name: K, wrapper: (original: ApiFunctions[K]) => ApiFunctions[K]) => void
}

/**
 * API registry implementation for managing and accessing plugin APIs
 * Provides a safe way for plugins to register and consume each other's functionality
 */
export class ApiRegistryImpl implements ApiRegistry {
  private apis = new Map<string, ApiFunction>()
  private context: CrawlerContext
  private logger

  constructor(context: CrawlerContext) {
    this.context = context
    this.logger = context.getLogger('core:api-registry')
  }

  /**
   * Register an API function
   * @param name Unique API name
   * @param fn Function to register
   */
  public register<T extends ApiFunction>(name: string, fn: T): void {
    if (this.apis.has(name)) {
      this.logger.warn(`API "${name}" is being overridden`, { apiName: name })
    }

    this.apis.set(name, fn)
    this.logger.debug(`Registered API: ${name}`, { apiName: name })
  }

  /**
   * Get a registered API function
   * @param name API name
   * @returns The API function or undefined if not found
   */
  public get<T extends ApiFunction>(name: string): T {
    const api = this.apis.get(name) as T
    if (!api) {
      this.logger.debug(`API "${name}" not found`, { apiName: name })
      throw new Error(`API "${name}" not found. Please ensure it is registered before use.`)
    }
    return api
  }

  /**
   * Wrap an existing API with middleware functionality
   * @param name API name to wrap
   * @param wrapper Function that receives the original API and returns a new one
   */
  public wrap<T extends ApiFunction>(
    name: string,
    wrapper: (original: T) => T,
  ): void {
    const original = this.get<T>(name)
    if (!original) {
      throw new Error(`Cannot wrap non-existent API: ${name}`)
    }

    const wrapped = wrapper(original)
    this.register(name, wrapped)
    this.logger.debug(`Wrapped API: ${name}`, { apiName: name })
  }

  /**
   * Get all registered API names
   * @returns Array of API names
   */
  public getRegisteredNames(): string[] {
    return Array.from(this.apis.keys())
  }

  /**
   * Check if an API is registered
   * @param name API name
   * @returns True if the API exists
   */
  public has(name: string): boolean {
    return this.apis.has(name)
  }
}
