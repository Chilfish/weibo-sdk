import type { CrawlerConfig, CrawlerContext, Logger } from './types'
import winston from 'winston'
import { ApiRegistryImpl } from './api-registry'
import { HookableImpl } from './hookable'

/**
 * Crawler context implementation that provides shared state and services
 * Acts as the central hub for plugin communication and system services
 */
export class CrawlerContextImpl implements CrawlerContext {
  public readonly config: CrawlerConfig
  public readonly hooks: HookableImpl
  public readonly apis: ApiRegistryImpl
  private readonly rootLogger: winston.Logger
  private readonly loggers = new Map<string, Logger>()

  constructor(config: CrawlerConfig = {}) {
    this.config = config

    // Initialize Winston logger
    this.rootLogger = winston.createLogger({
      level: config.logger?.level || 'info',
      format:
        config.logger?.format === 'json'
          ? winston.format.combine(
              winston.format.timestamp(),
              winston.format.errors({ stack: true }),
              // winston.formaton(),
            )
          : winston.format.combine(
              winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
              winston.format.errors({ stack: true }),
              winston.format.printf(
                ({ timestamp, level, message, namespace, ...meta }) => {
                  const namespaceStr = namespace ? `[${namespace}]` : ''
                  const metaStr
                    = Object.keys(meta).length > 0
                      ? ` ${JSON.stringify(meta)}`
                      : ''
                  return `${timestamp} ${level.toUpperCase()} ${namespaceStr} ${message}${metaStr}`
                },
              ),
            ),
      transports: [new winston.transports.Console()],
    })

    // Initialize subsystems
    this.hooks = new HookableImpl()
    this.apis = new ApiRegistryImpl(this)

    // Set context reference for hooks
    this.hooks._setContext(this)
  }

  /**
   * Get a logger instance for a specific namespace
   * @param namespace Optional namespace for the logger
   * @returns Logger instance
   */
  public getLogger(namespace?: string): Logger {
    const cacheKey = namespace || 'default'

    if (this.loggers.has(cacheKey)) {
      return this.loggers.get(cacheKey)!
    }

    const logger: Logger = {
      error: (message: string, meta?: object) => {
        this.rootLogger.error(message, { namespace, ...meta })
      },
      warn: (message: string, meta?: object) => {
        this.rootLogger.warn(message, { namespace, ...meta })
      },
      info: (message: string, meta?: object) => {
        this.rootLogger.info(message, { namespace, ...meta })
      },
      debug: (message: string, meta?: object) => {
        this.rootLogger.debug(message, { namespace, ...meta })
      },
    }

    this.loggers.set(cacheKey, logger)
    return logger
  }

  /**
   * Cleanup resources when context is no longer needed
   */
  public async dispose(): Promise<void> {
    // Call shutdown hooks
    await this.hooks.call('onShutdown')

    // Close logger transports
    this.rootLogger.close()
  }
}
