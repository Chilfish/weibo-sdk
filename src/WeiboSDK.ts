// src/WeiboSDK.ts
import type { IWeiboConfig } from './types/config'
import type { WeiboSDKLifecycleEvent, WeiboSDKSelfCheckMode } from './types/hooks'
import { InvalidConfigError } from './models/errors/ConfigError'
import { ArchiveService } from './services/public/ArchiveService'
import { FavoriteService } from './services/public/FavoriteService'
import { FollowingsService } from './services/public/FollowingsService'
import { SearchService } from './services/public/SearchService'
import { TrendsService } from './services/public/TrendsService'
import { TweetService } from './services/public/TweetService'
import { UserService } from './services/public/UserService'
import { resolveCookieInput } from './utils/cookieInput'

let sdkTraceSeq = 0
function createSdkTraceId(): string {
  sdkTraceSeq += 1
  return `${Date.now()}-${sdkTraceSeq}`
}

/**
 * 微博 SDK 门面（Facade）。
 *
 * 用一份 `config` 统一装配 Cookie/XSRF 鉴权、限流、hooks 与 telemetry，
 * 并把能力拆成领域 Service 暴露给下游：
 *
 * - `users` / `tweets` / `followings` / `favorites` / `trends` / `search`：领域服务（继承 HTTP 核心）
 * - `archive`：单账号归档流（timeline + favorites，可断点续传）
 *
 * 构造本身**不发请求**（例外：`config.selfCheck.mode: 'eager'` 会在后台启动一次自检，
 * 失败不产生未处理 rejection，而是在后续请求前抛出）。
 *
 * @example
 * const sdk = new WeiboSDK({ cookie: process.env.WEIBO_COOKIE ?? '' })
 * const me = await sdk.users.myDetails()
 */
export class WeiboSDK {
  /** 用户领域服务：用户信息 / 详情 / 当前登录用户（也用于会话自检）。 */
  public readonly users: UserService
  /** 微博领域服务：列表 / 详情 / 评论 / 转发 / 日期检索 / 首页 Feed，含归一化路径。 */
  public readonly tweets: TweetService
  /** 关注关系服务：关注列表与粉丝列表（cursor 分页）。 */
  public readonly followings: FollowingsService
  /** 收藏服务：收藏夹内容与收藏标签。 */
  public readonly favorites: FavoriteService
  /** 热搜服务：热搜 / 话题 / 文娱榜单。 */
  public readonly trends: TrendsService
  /** 搜索服务：搜索用户与微博（上游接口当前失效，见方法注释）。 */
  public readonly search: SearchService
  /** 归档服务：把 timeline + favorites 串成可恢复的 AsyncIterator。 */
  public readonly archive: ArchiveService
  private readonly selfCheckMode: WeiboSDKSelfCheckMode
  private readyPromise?: Promise<void>
  private readyError?: unknown

  /**
   * 装配全部子 Service 并发出 `sdk_init` 生命周期事件。
   *
   * `config.selfCheck.mode: 'eager'` 时会在构造末尾立即（不 await）触发一次会话自检。
   *
   * @param config SDK 配置，至少需要非空的 `cookie`
   * @throws `InvalidConfigError`（code `CONFIG_INVALID`）缺少 `cookie` 时抛出
   */
  constructor(private readonly config: IWeiboConfig) {
    // Cookie 支持 header 串或文件路径：在这里解析一次，避免每个 Service 各读一次文件。
    this.config = { ...config, cookie: resolveCookieInput(config.cookie) }
    this.validateConfig(this.config)
    this.selfCheckMode = this.config.selfCheck?.mode ?? 'lazy'

    const deps = {
      hooks: config.hooks,
      preflight: () => this.ensureReady(),
    }

    this.users = new UserService(config, deps)
    this.tweets = new TweetService(config, deps)
    this.followings = new FollowingsService(config, deps)
    this.favorites = new FavoriteService(config, deps)
    this.trends = new TrendsService(config, deps)
    this.search = new SearchService(config, deps)
    this.archive = new ArchiveService({
      tweets: this.tweets,
      favorites: this.favorites,
      telemetry: config.telemetry,
    })

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
   *
   * 自检结果会被缓存：成功后续不再重复请求，失败则把错误缓存下来、在每次请求前重抛。
   *
   * @throws `InvalidConfigError` / 会话相关的结构化错误（`WeiboSDKError` 子类，携带 `code` / `level` / `retryable`）
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
   *
   * 与 `selfCheck()` 的区别：不缓存结果、不走 lazy/eager 自检流程，仅做一次
   * `ajax/profile/detail` 探测，适合 CLI 里的「是否登录」提示。
   *
   * @returns `true` 表示 Cookie 仍可用；任何异常（含网络错误）都归为 `false`
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
