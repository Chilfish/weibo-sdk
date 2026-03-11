// src/WeiboSDK.ts
import type { IWeiboConfig } from './types/config'
import type { WeiboSDKLifecycleEvent, WeiboSDKSelfCheckMode } from './types/hooks'
import { InvalidConfigError } from './models/errors/ConfigError'
import { TweetService } from './services/public/TweetService'
import { UserService } from './services/public/UserService'

let sdkTraceSeq = 0
function createSdkTraceId(): string {
  sdkTraceSeq += 1
  return `${Date.now()}-${sdkTraceSeq}`
}

export class WeiboSDK {
  public readonly users: UserService
  public readonly tweets: TweetService
  private readonly selfCheckMode: WeiboSDKSelfCheckMode
  private readyPromise?: Promise<void>
  private readyError?: unknown

  constructor(private readonly config: IWeiboConfig) {
    this.validateConfig(config)
    this.selfCheckMode = config.selfCheck?.mode ?? 'lazy'

    const deps = {
      hooks: config.hooks,
      preflight: () => this.ensureReady(),
    }

    this.users = new UserService(config, deps)
    this.tweets = new TweetService(config, deps)

    void this.emitLifecycle({
      event_name: 'sdk_init',
      timestamp: Date.now(),
      trace_id: createSdkTraceId(),
    })

    if (this.selfCheckMode === 'eager') {
      void this.ensureReady().catch(() => {})
    }
  }

  private validateConfig(config: IWeiboConfig): void {
    if (!config.cookie) {
      throw new InvalidConfigError('Weibo SDK requires a valid cookie in configuration.', {
        field: 'cookie',
      })
    }
  }

  /**
   * 启动自检：配置 + Cookie 会话有效性。
   *
   * 说明：该方法会触发一次 `ajax/profile/detail` 请求（不带 uid），用于判断 Cookie 是否过期。
   */
  async selfCheck(): Promise<void> {
    this.validateConfig(this.config)
    await this.ensureReady()
  }

  /**
   * `selfCheck()` 的 lazy/eager 实现：保证在首次请求前完成自检，且不会产生未处理的 Promise rejection。
   */
  private async ensureReady(): Promise<void> {
    if (this.selfCheckMode === 'none')
      return

    if (this.readyError)
      throw this.readyError

    if (this.readyPromise)
      return this.readyPromise

    const traceId = createSdkTraceId()
    this.readyPromise = (async () => {
      await this.emitLifecycle({
        event_name: 'self_check_start',
        mode: this.selfCheckMode,
        timestamp: Date.now(),
        trace_id: traceId,
      })

      try {
        await this.users.myDetails()
        await this.emitLifecycle({
          event_name: 'self_check_ok',
          timestamp: Date.now(),
          trace_id: traceId,
        })
      }
      catch (error) {
        this.readyError = error
        await this.emitLifecycle({
          event_name: 'self_check_error',
          error,
          timestamp: Date.now(),
          trace_id: traceId,
        })
        throw error
      }
    })()

    return this.readyPromise
  }

  private async emitLifecycle(event: WeiboSDKLifecycleEvent): Promise<void> {
    await this.config.hooks?.onLifecycle?.(event)
  }

  /**
   * 检查当前会话有效性（不会抛出业务错误，失败则返回 false）
   */
  async checkSession(): Promise<boolean> {
    try {
      await this.users.myDetails()
      return true
    }
    catch {
      return false
    }
  }
}
