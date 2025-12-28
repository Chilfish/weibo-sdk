import type { IHttpClient, Logger, PlatformConfig, UserConfig } from '../types/core'
import { Hookable } from './events'
import { AxiosHttpClient } from './http'
import { ProviderRegistry } from './registry'

// 简单的 Console Logger 实现，生产环境应替换为 Pino
function createDefaultLogger(level: string = 'info'): Logger {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 }
  const currentLevel = levels[level as keyof typeof levels] || 1

  const log = (lvl: string, ...args: any[]) => {
    if (levels[lvl as keyof typeof levels] >= currentLevel) {
      console.log(`[${new Date().toISOString()}] [${lvl.toUpperCase()}]`, ...args)
    }
  }

  return {
    debug: (o, m) => log('debug', m || o, m ? o : ''),
    info: (o, m) => log('info', m || o, m ? o : ''),
    warn: (o, m) => log('warn', m || o, m ? o : ''),
    error: (o, m) => log('error', m || o, m ? o : ''),
    child: () => createDefaultLogger(level), // Simplification
  }
}

export class CrawlerContext {
  public readonly config: UserConfig
  public readonly logger: Logger
  public readonly hooks: Hookable
  public readonly providers: ProviderRegistry
  public readonly http: IHttpClient

  constructor(config: UserConfig) {
    this.config = config
    this.logger = createDefaultLogger(config.logLevel)
    this.hooks = new Hookable()
    this.providers = new ProviderRegistry(this.logger)

    // 初始化 Axios Client，设置全局默认 Header
    this.http = new AxiosHttpClient({
      'User-Agent': config.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
    })
  }

  /**
   * 辅助方法：获取特定平台的配置合并结果
   */
  public getPlatformConfig(platformName: string): PlatformConfig {
    return this.config.credentials?.[platformName] || {}
  }
}
