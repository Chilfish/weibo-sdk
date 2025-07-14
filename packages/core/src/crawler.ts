import type { CrawlerConfig, Plugin } from './types'
import { corePlugins } from '@weibo-sdk/plugins'
import { taskPlugins } from '../../weibo/src'
import { mergeConfigs } from './config'
import { CrawlerContextImpl } from './context'

/**
 * Main crawler class that orchestrates the entire crawling process
 * Acts as the entry point and coordinator for all plugins and operations
 */
export class Crawler {
  public readonly context: CrawlerContextImpl
  private readonly plugins: Plugin[]
  private isSetup = false
  private isRunning = false

  constructor(config: CrawlerConfig = {}) {
    this.context = new CrawlerContextImpl(mergeConfigs(config))
    this.plugins = [
      corePlugins,
      taskPlugins,
      config.plugins || [],
    ].flat()
  }

  /**
   * Initialize the crawler and all plugins
   * Must be called before running any operations
   */
  public async setup(): Promise<void> {
    if (this.isSetup) {
      throw new Error('Crawler has already been set up')
    }

    const logger = this.context.getLogger('core:crawler')
    logger.info('Setting up crawler', this.context.config)

    try {
      // Call setup hooks
      await this.context.hooks.call('onSetup')

      // Initialize plugins in order
      for (const plugin of this.plugins) {
        logger.debug(`Setting up plugin: ${plugin.name}`)
        await plugin.setup(this.context)
        logger.debug(`Plugin setup complete: ${plugin.name}`)
      }

      // Call ready hooks
      await this.context.hooks.call('onReady')

      this.isSetup = true
      logger.info('Crawler setup complete')
    }
    catch (error) {
      logger.error('Failed to set up crawler', { error })
      throw error
    }
  }

  /**
   * Run the crawler with optional task parameters
   * @param params Optional parameters to pass to the main task
   */
  public async run<T = any>(params?: T): Promise<void> {
    if (!this.isSetup) {
      throw new Error(
        'Crawler must be set up before running. Call setup() first.',
      )
    }

    if (this.isRunning) {
      throw new Error('Crawler is already running')
    }

    const logger = this.context.getLogger('core:crawler')
    logger.info('Starting crawler run', { params })

    this.isRunning = true

    try {
      // Call before run hooks
      await this.context.hooks.call('onBeforeRun', params)

      // Execute main task if registered
      const mainTask = this.context.apis.get('task:main')
      if (mainTask) {
        logger.debug('Executing main task')
        await mainTask(params)
      }
      else {
        logger.warn(
          'No main task registered. Use a task plugin to register a main task.',
        )
      }

      // Call after run hooks
      await this.context.hooks.call('onAfterRun', params)

      logger.info('Crawler run completed successfully')
    }
    catch (error) {
      logger.error('Crawler run failed', { error })
      await this.context.hooks.call('onError', error)
      throw error
    }
    finally {
      this.isRunning = false
    }
  }

  /**
   * Stop the crawler and cleanup resources
   */
  public async stop(): Promise<void> {
    const logger = this.context.getLogger('core:crawler')
    logger.info('Stopping crawler')

    try {
      this.isRunning = false
      await this.context.dispose()
      logger.info('Crawler stopped successfully')
    }
    catch (error) {
      logger.error('Error during crawler shutdown', { error })
      throw error
    }
  }

  /**
   * Check if the crawler is currently running
   */
  public get running(): boolean {
    return this.isRunning
  }

  /**
   * Check if the crawler has been set up
   */
  public get ready(): boolean {
    return this.isSetup
  }
}
