import type { CapabilityFilter, WeiboCapability } from './capabilities'
import type { AuthContext } from './services/internal/CredentialResolver'
// src/WeiboSDK.ts
import type { IWeiboConfig } from './types/config'
import type {
  WeiboSDKLifecycleEvent,
  WeiboSDKSelfCheckMode,
} from './types/hooks'
import type { WeiboSessionContext } from './types/session'
import { listCapabilities } from './capabilities'
import { WeiboSessionExpiredError } from './models/errors/BusinessError'
import { WeiboSDKError } from './models/errors/WeiboSDKError'
import { createAuthContext, resolveAuthMode } from './services/internal/CredentialResolver'
import { createPluginPipeline } from './services/internal/plugins'
import { ArchiveService } from './services/public/ArchiveService'
import { CommentHistoryService } from './services/public/CommentHistoryService'
import { FavoriteService } from './services/public/FavoriteService'
import { FollowingsService } from './services/public/FollowingsService'
import { LikeService } from './services/public/LikeService'
import { MediaService } from './services/public/MediaService'
import { NotificationService } from './services/public/NotificationService'
import { SearchService } from './services/public/SearchService'
import { TopicService } from './services/public/TopicService'
import { TrendsService } from './services/public/TrendsService'
import { TweetService } from './services/public/TweetService'
import { UserArchiveService } from './services/public/UserArchiveService'
import { UserService } from './services/public/UserService'
import { resolveCookieInput } from './utils/cookieInput'
import { combineTelemetry, createLoggerBridge } from './utils/logger'

let sdkTraceSeq = 0
function createSdkTraceId(): string {
  sdkTraceSeq += 1
  return `${Date.now()}-${sdkTraceSeq}`
}

/**
 * 自检失败是否值得缓存。
 *
 * 只缓存确定性失败（Cookie 失效、配置错误、协议不匹配）：这些错误重试也不会自愈。
 * 网络抖动 / 限流（`retryable: true`）必须在下次调用时重新探测，否则一次瞬时失败会
 * 永久毒化实例——这对长驻归档进程是致命缺陷。
 */
function isDeterministicSelfCheckError(error: unknown): boolean {
  return error instanceof WeiboSDKError && !error.retryable
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
  /** 点赞服务：我赞过的微博（page 游标，无 total）。 */
  public readonly likes: LikeService
  /** 历史评论服务：当前登录用户发表过的评论（max_id 游标，只读自己的）。 */
  public readonly commentHistory: CommentHistoryService
  /** 媒体服务：用户图片墙与视频瀑布（cursor 分页）。 */
  public readonly media: MediaService
  /** 消息通知服务：评论通知 / 点赞通知（max_id 游标）。 */
  public readonly notifications: NotificationService
  /** 超话服务：分类、列表与关键词搜索（D7）。 */
  public readonly topics: TopicService
  /** 热搜服务：热搜 / 话题 / 文娱榜单。 */
  public readonly trends: TrendsService
  /** 搜索服务：搜索用户与微博（上游接口当前失效，见方法注释）。 */
  public readonly search: SearchService
  /** 归档服务：把 timeline + favorites 串成可恢复的 AsyncIterator。 */
  public readonly archive: ArchiveService
  /** 范围归档服务：指定时间范围 + 单条深度补全（详情 / 评论 / 楼中楼 / 转发），可续跑。 */
  public readonly userArchive: UserArchiveService
  private readonly authContext: AuthContext
  private readonly pipeline: ReturnType<typeof createPluginPipeline>
  private readonly loggerBridge?: ReturnType<typeof createLoggerBridge>
  private readonly selfCheckMode: WeiboSDKSelfCheckMode
  private readyPromise?: Promise<void>
  private readyError?: unknown
  private session?: WeiboSessionContext
  private sessionPromise?: Promise<WeiboSessionContext>

  /**
   * 装配全部子 Service 并发出 `sdk_init` 生命周期事件。
   *
   * `config.selfCheck.mode: 'eager'` 时会在构造末尾立即（不 await）触发一次会话自检。
   *
   * @param config SDK 配置；Cookie 模式需要非空的 `cookie`，`auth: 'guest'` 或无 Cookie 时使用访客身份
   * @throws `InvalidConfigError`（code `CONFIG_INVALID`）`auth: 'cookie'` 但没有 Cookie 时抛出
   */
  constructor(private readonly config: IWeiboConfig) {
    // logger 只消费已有事件：组合成 telemetry sink，不新增埋点。
    this.loggerBridge = createLoggerBridge(config.logger)
    // Cookie 支持 header 串或文件路径：在这里解析一次，避免每个 Service 各读一次文件。
    this.config = {
      ...config,
      cookie: resolveCookieInput(config.cookie ?? ''),
      telemetry: combineTelemetry(config.telemetry, this.loggerBridge?.telemetry),
    }
    this.validateConfig(this.config)
    this.pipeline = createPluginPipeline(this.config.plugins)
    this.authContext = createAuthContext(this.config, {
      telemetry: this.config.telemetry,
    })
    this.selfCheckMode = this.config.selfCheck?.mode ?? 'lazy'

    const deps = {
      hooks: this.config.hooks,
      preflight: () => this.ensureReady(),
      auth: this.authContext,
      pipeline: this.pipeline,
    }

    this.users = new UserService(this.config, deps)
    this.tweets = new TweetService(this.config, deps, {
      // context() 只补 author 的简版资料（1 次 profile/info），不拉完整 User 详情。
      authorProfile: async uid => (await this.users.fetchRawInfo(uid)).data.user,
    })
    this.followings = new FollowingsService(this.config, deps)
    this.favorites = new FavoriteService(this.config, deps)
    this.likes = new LikeService(this.config, deps)
    this.commentHistory = new CommentHistoryService(this.config, deps)
    this.media = new MediaService(this.config, deps)
    this.notifications = new NotificationService(this.config, deps)
    this.topics = new TopicService(this.config, deps)
    this.trends = new TrendsService(this.config, deps)
    this.search = new SearchService(this.config, deps)
    this.archive = new ArchiveService({
      tweets: this.tweets,
      favorites: this.favorites,
      likes: {
        fetchRawPage: (uid, page) => this.likes.fetchRawPage(uid, page),
      },
      commentHistory: {
        fetchRawPage: options => this.commentHistory.fetchRawPage(options),
      },
      media: {
        fetchRawImagePage: (uid, options) =>
          this.media.fetchRawImagePage(uid, options),
        fetchRawVideoPage: (uid, options) =>
          this.media.fetchRawVideoPage(uid, options),
      },
      sessionUid: async () => (await this.getSession()).uid,
      authMode: this.authContext.mode,
      telemetry: this.config.telemetry,
    })

    this.userArchive = new UserArchiveService({
      streamArchive: (uid, options) => this.archive.streamArchive(uid, options),
      enrich: mblogId => this.tweets.enrich(mblogId),
      streamComments: (mblogId, options) => this.tweets.streamComments(mblogId, options),
      streamReplies: (mblogId, commentId, options) => this.tweets.streamReplies(mblogId, commentId, options),
      streamReposts: (mblogId, options) => this.tweets.streamReposts(mblogId, options),
      getUser: uid => this.users.getById(uid),
      authMode: this.authContext.mode,
      telemetry: this.config.telemetry,
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
    // 解析有效鉴权模式：`auth: 'cookie'` 但没有 Cookie 时在这里抛 `CONFIG_INVALID`。
    resolveAuthMode(config)
  }

  /**
   * 启动自检：配置 + Cookie 会话有效性。
   *
   * 说明：该方法会触发一次 `ajax/profile/detail` 请求（不带 uid），用于判断 Cookie 是否过期。
   *
   * 自检结果会被缓存：成功后续不再重复请求；确定性失败（Cookie 失效 / 配置错误 /
   * 协议不匹配）缓存后直接重抛，网络抖动 / 限流等可重试失败会在下次调用时重新探测。
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
    const readyPromise = (async () => {
      await this.emitLifecycle({
        event_name: 'self_check_start',
        mode: this.selfCheckMode,
        timestamp: Date.now(),
        trace_id: traceId,
      })

      try {
        // 自检与 session 上下文共享同一次 `profile/detail`，不额外发请求。
        await this.getSession()
        await this.emitLifecycle({
          event_name: 'self_check_ok',
          timestamp: Date.now(),
          trace_id: traceId,
        })
      }
      catch (error) {
        if (isDeterministicSelfCheckError(error))
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

    this.readyPromise = readyPromise

    try {
      await readyPromise
    }
    catch (error) {
      // 可重试失败不进入 readyError；同时清掉 rejected Promise，
      // 否则后续调用会直接复用这个失败结果。
      this.readyPromise = undefined
      throw error
    }
  }

  private async emitLifecycle(event: WeiboSDKLifecycleEvent): Promise<void> {
    this.loggerBridge?.lifecycle(event)
    this.pipeline.observe(event)
    await this.config.hooks?.onLifecycle?.(event)
  }

  /**
   * 返回 SDK 能力清单（离线静态注册表，不发请求）。
   *
   * 适合 Agent / 脚本在运行时发现「有哪些能力、是否需要 Cookie、分页类型、当前状态」。
   *
   * @param filter 可按服务名 / 状态过滤
   */
  public capabilities(filter: CapabilityFilter = {}): WeiboCapability[] {
    return listCapabilities(filter)
  }

  /**
   * 解析当前登录会话（uid / 详情 / 检查时间）。
   *
   * 实现要点：
   * - **不额外请求**：复用启动自检（lazy / eager）已经发出的 `ajax/profile/detail`；
   * - **single-flight + 实例级缓存**：并发调用共享同一个 Promise，成功后续直接返回；
   * - `selfCheck: { mode: 'none' }` 时依然可用，首次调用会主动探测一次；
   * - 失败不缓存，下次调用会重新探测。
   *
   * 适用场景：需要判断「目标 uid 是否为登录账号」的能力（收藏 / 历史评论 / 通知），
   * 以及 `whoami` 这类会话诊断。不要在高频循环里调用 `refresh: true`。
   *
   * @throws 会话相关的结构化错误（如 `AUTH_SESSION_EXPIRED`）
   */
  async getSession(options: { refresh?: boolean } = {}): Promise<WeiboSessionContext> {
    if (options.refresh) {
      this.session = undefined
      this.sessionPromise = undefined
    }
    else if (this.session) {
      return this.session
    }

    if (this.sessionPromise)
      return this.sessionPromise

    this.sessionPromise = (async () => {
      try {
        if (this.authContext.mode === 'guest') {
          const tokens = this.authContext.guestTokens
          if (!tokens) {
            throw new WeiboSessionExpiredError('Guest token service is not initialized.', {
              auth_mode: 'guest',
            })
          }
          if (options.refresh) {
            const refreshed = await tokens.refresh()
            if (!refreshed) {
              throw new WeiboSessionExpiredError('Failed to refresh the guest token.', {
                auth_mode: 'guest',
                reason: 'guest_token_issue',
              })
            }
          }
          const token = await tokens.getToken()
          const context: WeiboSessionContext = {
            authMode: 'guest',
            checkedAt: Date.now(),
            guestTokenIssuedAt: token.issuedAt,
          }
          this.session = context
          return context
        }

        const profile = await this.users.myDetails()
        const context: WeiboSessionContext = {
          authMode: 'cookie',
          uid: profile.uid,
          profile,
          checkedAt: Date.now(),
        }
        this.session = context
        return context
      }
      catch (error) {
        // 失败不缓存：网络抖动后下次仍可重试。
        this.sessionPromise = undefined
        throw error
      }
    })()

    return this.sessionPromise
  }

  /** 当前有效鉴权模式（构造时已确定，不随 Cookie 失效改变）。 */
  public get authMode(): 'cookie' | 'guest' {
    return this.authContext.mode
  }

  /**
   * 访客 token 状态（不含 token 明文）。
   *
   * guest 模式下若尚未发放 token，会触发一次发放（single-flight）。
   */
  public async getGuestTokenStatus(): Promise<{ issuedAt: number, scope: 'pc' | 'all', source: 'preset' | 'mobile' | 'desktop' } | undefined> {
    const tokens = this.authContext.guestTokens
    if (!tokens)
      return undefined
    const token = await tokens.getToken()
    return {
      issuedAt: token.issuedAt,
      scope: token.scope,
      source: token.source,
    }
  }

  /**
   * 检查当前会话有效性（不会抛出业务错误，失败则返回 false）
   *
   * 与 `getSession()` 共享缓存：同一实例只会在首次（或 `refresh: true`）时探测一次，
   * 适合 CLI 里的「是否登录」提示。
   *
   * @returns `true` 表示 Cookie 仍可用；任何异常（含网络错误）都归为 `false`
   */
  async checkSession(options: { refresh?: boolean } = {}): Promise<boolean> {
    try {
      await this.getSession(options)
      return true
    }
    catch {
      return false
    }
  }
}
