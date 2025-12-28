import type { IPlugin, ISNSProvider, UserConfig } from '../types/core'
import { CrawlerContext } from './context'

export class Crawler {
  public readonly context: CrawlerContext
  private plugins: IPlugin[]
  private isSetup: boolean = false

  constructor(config: UserConfig = {}) {
    this.context = new CrawlerContext(config)
    this.plugins = config.plugins || []
  }

  /**
   * 初始化 SDK，加载插件
   */
  public async setup(): Promise<void> {
    if (this.isSetup)
      return

    this.context.logger.info('Starting SNS-Kit setup...')

    const prePlugins = this.plugins.filter(p => p.enforce === 'pre')
    const normalPlugins = this.plugins.filter(p => !p.enforce)
    const postPlugins = this.plugins.filter(p => p.enforce === 'post')

    const runPlugins = async (list: IPlugin[]): Promise<void> => {
      for (const plugin of list) {
        try {
          this.context.logger.debug(`Loading plugin: ${plugin.name}`)
          await plugin.setup(this.context)
        }
        catch (error) {
          this.context.logger.error({ error }, `Failed to load plugin: ${plugin.name}`)
          throw error
        }
      }
    }

    await runPlugins(prePlugins)
    await runPlugins(normalPlugins)
    await runPlugins(postPlugins)

    this.isSetup = true
    this.context.logger.info('SNS-Kit setup complete.')
  }

  /**
   * 获取指定的 Provider
   */
  public getProvider(platformName: string): ISNSProvider {
    if (!this.isSetup) {
      throw new Error('Crawler not setup. Please call crawler.setup() first.')
    }
    return this.context.providers.get(platformName)
  }
}
