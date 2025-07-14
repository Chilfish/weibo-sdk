import type { CrawlerConfig } from './types'

/**
 * Define configuration for the crawler with type safety
 * This function provides type checking and defaults for the crawler configuration
 *
 * @param config Configuration object
 * @returns Validated configuration object
 *
 * @example
 * ```typescript
 * const config = defineConfig({
 *   plugins: [fetcherPlugin(), loggerPlugin()],
 *   logger: {
 *     level: 'debug',
 *     format: 'json'
 *   },
 *   http: {
 *     timeout: 30000,
 *     retries: 3
 *   }
 * })
 * ```
 */
export function defineConfig(config: CrawlerConfig): CrawlerConfig {
  return config
}

/**
 * Merge multiple configuration objects with proper precedence
 * Later configurations override earlier ones
 *
 * @param configs Configuration objects to merge
 * @returns Merged configuration
 */
export function mergeConfigs(
  ...configs: Partial<CrawlerConfig>[]
): CrawlerConfig {
  const merged: CrawlerConfig = {
    plugins: [],
    logger: {
      level: 'info',
      format: 'simple',
    },
    fetcher: {
      baseURL: 'https://m.weibo.cn',
      timeout: 30000,
      retries: 3,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    },
  }

  for (const config of configs) {
    if (config.plugins) {
      merged.plugins = [...(merged.plugins || []), ...config.plugins]
    }

    if (config.logger) {
      merged.logger = { ...merged.logger, ...config.logger }
    }

    if (config.fetcher) {
      merged.fetcher = { ...merged.fetcher, ...config.fetcher }
    }
  }

  return merged
}
