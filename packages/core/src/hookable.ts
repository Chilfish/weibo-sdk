import type {
  CrawlerContext,
  Hookable,
  Listener,
  WaterfallListener,
} from './types'

/**
 * Hook system implementation for the crawler framework
 * Supports both parallel execution and waterfall (sequential transformation) patterns
 */
export class HookableImpl implements Hookable {
  private hooks = new Map<string, Listener[]>()

  /**
   * Register a hook listener
   * @param name Hook name
   * @param listener Listener function
   */
  public on<T = any>(name: string, listener: Listener<T>): void {
    if (!this.hooks.has(name)) {
      this.hooks.set(name, [])
    }
    this.hooks.get(name)!.push(listener)
  }

  /**
   * Call all listeners for a hook in parallel
   * @param name Hook name
   * @param payload Data to pass to listeners
   */
  public async call<T = any>(name: string, payload?: T): Promise<void> {
    const listeners = this.hooks.get(name)
    if (!listeners || listeners.length === 0) {
      return
    }

    // Execute all listeners in parallel
    await Promise.all(
      listeners.map(async (listener) => {
        try {
          await listener(payload, this.context)
        }
        catch (error) {
          // Log error but continue with other listeners
          this.context
            .getLogger('core:hooks')
            .error(`Error in hook listener for "${name}"`, {
              error,
              hookName: name,
            })
        }
      }),
    )
  }

  /**
   * Call listeners in waterfall mode (sequential transformation)
   * Each listener receives the result of the previous one
   * @param name Hook name
   * @param payload Initial data
   * @returns Transformed data
   */
  public async waterfall<T = any>(name: string, payload: T): Promise<T> {
    const listeners = this.hooks.get(name) as
      | WaterfallListener<T>[]
      | undefined
    if (!listeners || listeners.length === 0) {
      return payload
    }

    let result = payload
    for (const listener of listeners) {
      try {
        const transformed = await listener(result, this.context)
        result = transformed
      }
      catch (error) {
        this.context
          .getLogger('core:hooks')
          .error(`Error in waterfall hook listener for "${name}"`, {
            error,
            hookName: name,
          })
        throw error
      }
    }

    return result
  }

  private context!: CrawlerContext

  /**
   * Internal method to set context reference
   * @internal
   */
  public _setContext(context: CrawlerContext): void {
    this.context = context
  }
}
