/**
 * @weibo-sdk/core - Core framework for weibo crawler SDK
 *
 * This package provides the foundational architecture for building
 * extensible and maintainable web crawlers through a plugin system.
 */

export { ApiRegistryImpl as ApiRegistry } from './api-registry'
// Configuration utilities
export { defineConfig, mergeConfigs } from './config'
export { CrawlerContextImpl as CrawlerContext } from './context'
// Core classes
export { Crawler } from './crawler'

// Default export for convenience
export { Crawler as default } from './crawler'

export { HookableImpl as Hookable } from './hookable'

// Types and interfaces
export type {
  ApiFunction,
  CrawlerConfig,
  HttpClient,
  CrawlerContext as ICrawlerContext,
  Hookable as IHookable,
  Listener,
  Logger,
  Plugin,
  WaterfallListener,
} from './types'

// Error classes
export { AuthenticationError, NetworkError, SkipItemError } from './types'
