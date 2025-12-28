type HookListener<T = any> = (data: T) => Promise<void> | void

export class Hookable {
  private hooks: Map<string, HookListener[]> = new Map()

  /**
   * 注册监听器
   */
  public on<T = any>(event: string, listener: HookListener<T>): () => void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, [])
    }
    this.hooks.get(event)!.push(listener)

    // Return unsubscriber
    return () => {
      const listeners = this.hooks.get(event)
      if (listeners) {
        this.hooks.set(event, listeners.filter(l => l !== listener))
      }
    }
  }

  /**
   * 并行触发所有监听器
   */
  public async call<T = any>(event: string, data: T): Promise<void> {
    const listeners = this.hooks.get(event)
    if (!listeners || listeners.length === 0)
      return

    await Promise.all(listeners.map(fn => fn(data)))
  }

  /**
   * 串行触发（可选）- 用于必须按顺序处理的场景
   */
  public async callSerial<T = any>(event: string, data: T): Promise<void> {
    const listeners = this.hooks.get(event)
    if (!listeners)
      return

    for (const fn of listeners) {
      await fn(data)
    }
  }
}
