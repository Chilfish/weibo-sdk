# 从脚本工具到框架：构建一个现代、可扩展的插件化爬虫系统

在软件开发的初期，我们常常从一个简单的脚本或一个面向对象的工具类开始。对于微博爬虫 SDK 而言，这可能意味着一个包含`Fetcher`、`Parser`和`Service`的类库。这个模型在初期运行良好，但随着功能需求的增长——例如支持不同的运行环境、允许用户自定义数据处理逻辑、或是集成复杂的任务调度——它会逐渐暴露出可维护性和可扩展性的瓶颈。每一次新增功能，都可能需要深入修改核心代码，这违背了“开闭原则”。

为了突破这一局限，我们需要一次架构上的跃迁：将 SDK 从一个封闭的“工具”重塑为一个开放的“框架”。本文将详细阐述如何借鉴 Vite、Nuxt.js 等现代前端框架的设计哲学，利用 TypeScript 构建一个以插件为核心、高度可扩展、并拥有极致开发者体验（DX）的爬虫系统。

## 一、 核心架构：从一次性任务到长效服务框架

我们的第一步，是改变对爬虫 SDK 实例的认知。它不应再是一个执行完单一任务即销毁的脚本，而应是一个可以被初始化、配置并反复调用的长生命周期服务。

### 1.1 `Crawler`：系统的大脑

`Crawler`实例是整个系统的核心协调者。它在启动时加载所有插件、完成初始化，然后进入待命状态，准备执行由外部调度的具体任务。

```typescript
// src/core/crawler.ts
import { corePlugins } from '../plugins'
import { InternalAPIs, Plugin, UserConfig } from '../types'
import { CrawlerContext } from './context'

export class Crawler {
  public context: CrawlerContext
  private plugins: Plugin[]

  constructor(userConfig: UserConfig = {}) {
    this.context = new CrawlerContext(userConfig)

    // 加载所有内部核心插件，并追加用户自定义插件
    const userPlugins = userConfig.plugins || []
    this.plugins = [...corePlugins, ...userPlugins]
  }

  /**
   * 初始化框架，按顺序执行所有插件的 setup 方法。
   * 这个过程只在启动时执行一次。
   */
  public async setup(): Promise<void> {
    const prePlugins = this.plugins.filter(p => p.enforce === 'pre')
    const normalPlugins = this.plugins.filter(p => !p.enforce)
    const postPlugins = this.plugins.filter(p => p.enforce === 'post')

    const runSetup = async (plugins: Plugin[]) => {
      for (const plugin of plugins) {
        await plugin.setup(this.context)
      }
    }

    // 严格按照 pre -> normal -> post 的顺序执行插件初始化
    await runSetup(prePlugins)
    await runSetup(normalPlugins)
    await runSetup(postPlugins)

    this.context.getLogger('core:engine').info('Crawler setup complete. Ready for tasks.')
  }

  /**
   * 执行一个具体的、已注册的任务。
   * @param taskName 任务的唯一标识符
   * @param params 任务执行所需的参数
   */
  public async run<T extends keyof InternalAPIs>(
    taskName: T,
    params: Parameters<InternalAPIs[T]['execute']>[0],
  ): Promise<void> {
    const taskPluginAPI = this.context.apis.get(taskName)
    if (!taskPluginAPI || !('execute' in taskPluginAPI)) {
      throw new Error(`Task '${String(taskName)}' not found or is not executable.`)
    }

    // 为本次运行创建独立的“执行上下文”
    const executionContext = { ...params, runId: Date.now().toString() }
    const logger = this.context.getLogger(`task:${String(taskName)}`).child({ runId: executionContext.runId })

    try {
      logger.info({ params }, 'Task started.')
      await this.context.hooks.call('beforeTask', { taskName, context: executionContext })

      await (taskPluginAPI.execute as (params: any) => Promise<void>)(executionContext)

      await this.context.hooks.call('afterTask', { taskName, context: executionContext })
      logger.info('Task finished successfully.')
    }
    catch (error) {
      logger.error({ error }, 'Task failed with an unhandled exception.')

      // 调用全局错误钩子，让用户可以自定义处理
      await this.context.hooks.call('onTaskError', {
        taskName,
        error,
        context: executionContext,
      })

      // 重新抛出错误，以便上层调用者可以感知到任务失败
      throw error
    }
  }
}
```

### 1.2 `CrawlerContext`：流动的血液

如果`Crawler`是大脑，`CrawlerContext`就是连接所有器官的血液。它是一个贯穿整个应用生命周期的对象，负责携带配置、共享状态、并提供核心服务。

在本次架构重构中，我们引入了 `ProviderRegistry`，用于专门管理不同 SNS 平台（如 Weibo, Twitter）的能力实现。

```typescript
import pino from 'pino'
// src/core/context.ts
import { IHttpClient, InternalAPIs, Logger, UserConfig } from '../types'
import { ApiRegistry } from './api-registry'
import { Hookable } from './hookable'
import { HttpClient } from './network/http-client'
import { ProviderRegistry } from './provider-registry'

export class CrawlerContext {
  public config: UserConfig
  public hooks: Hookable
  public readonly httpClient: IHttpClient

  // 用于注册通用工具能力（如 Database, Notifier）
  public readonly apis: ApiRegistry<InternalAPIs>

  // 用于注册平台特定实现（如 WeiboProvider, TwitterProvider）
  public readonly providers: ProviderRegistry

  private readonly rootLogger: Logger
  // 为状态管理等高级功能预留位置
  [key: string]: any

  constructor(userConfig: UserConfig) {
    this.config = userConfig
    this.hooks = new Hookable()
    this.httpClient = new HttpClient(userConfig.network)
    this.apis = new ApiRegistry<InternalAPIs>(this)
    this.providers = new ProviderRegistry(this)

    const logLevel = this.config.logLevel || 'info'

    if (userConfig.createLogger) {
      // 用户提供了自定义的 logger 工厂
      this.rootLogger = userConfig.createLogger({ level: logLevel })
    }
    else {
      // 使用内置的 pino 作为默认 logger
      this.rootLogger = pino({
        level: logLevel,
        // 在非生产环境美化输出，方便开发
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty' }
            : undefined,
      })
    }
  }

  /**
   * 获取一个带有命名空间的子 logger
   * @param name - 通常是插件名或任务名
   */
  public getLogger(name: string): Logger {
    // child logger 会自动继承父 logger 的所有设置，并附加新的字段
    return this.rootLogger.child({ name })
  }
}
```

### 1.3 `defineConfig`：优雅的配置入口

为了提供极致的开发者体验，我们为用户提供一个`defineConfig`辅助函数。它本身不做什么，但能为配置对象提供完整的 TypeScript 类型提示和自动补全，极大地降低了用户的配置门槛。

```typescript
// src/sdk.ts
import { UserConfig } from './types'

export function defineConfig(config: UserConfig): UserConfig {
  return config
}
```

### 1.4 `IHttpClient`：网络层的拦截器模式

为了解决爬虫中常见的反爬策略（如 Cookie 轮询、IP 代理切换、User-Agent 伪装）以及速率限制，我们将网络请求逻辑从 `Provider` 中剥离，下沉到统一的 `HttpClient` 层。这一层支持中间件（Middleware）机制，使得我们可以在请求发出前和响应返回后插入自定义逻辑，例如自动重试、签名计算、以及至关重要的**速率限制（Rate Limiting）**。

```typescript
// src/core/network/http-client.ts

export interface RequestContext {
  proxy?: string
  cookies?: string // 微博必须带 Cookie
  headers: Record<string, string>
  priority: 'high' | 'normal' | 'low'
}

export interface IHttpClient {
  get: <T = any>(url: string, context?: Partial<RequestContext>) => Promise<T>
  post: <T = any>(url: string, body: any, context?: Partial<RequestContext>) => Promise<T>
  // 注册中间件：重试、限流、签名计算都在这里做
  use: (middleware: Middleware) => void
}
```

## 二、 插件体系：解耦与扩展的基石

插件是这套系统的核心。每一个独立的功能，无论是数据获取、解析，还是一个完整的业务任务，都应该被封装成一个插件。

### 2.1 插件契约：`Plugin`接口

一个插件就是一个符合特定接口的对象。我们引入`enforce`属性，用来控制插件的加载顺序，这是实现可预测的插件覆盖与扩展的关键。

```typescript
// src/types.ts
export interface Plugin {
  name: string
  // 'pre': 优先执行，通常用于覆盖核心功能
  // 'post': 最后执行，通常用于增强或收尾工作
  // undefined (默认): 普通插件
  enforce?: 'pre' | 'post'
  setup: (context: CrawlerContext) => Promise<void> | void
}
```

### 2.2 核心抽象：Provider Pattern (适配器模式升级版)

为了支持多平台扩展并统一操作原语，我们不再让用户直接调用底层的 `fetcher`，而是建立一套统一的 **SNS 操作原语（Primitives）**。

#### 定义统一接口 `ISNSProvider`

所有平台插件（WeiboPlugin, TwitterPlugin）都必须实现此接口。这确保了无论底层平台如何变化，上层业务逻辑（如数据入库、清洗）都能保持稳定。

```typescript
// src/types/provider.ts
import { z } from 'zod'

// 使用 Zod 定义运行时 Schema，确保数据干净
export const UnifiedPostSchema = z.object({
  id: z.string(),
  content: z.string(),
  author: z.object({ /* ... */ }),
  // ... 其他字段
})

export type UnifiedPost = z.infer<typeof UnifiedPostSchema>

export interface ISNSProvider {
  readonly platformName: string

  // 核心：将动态的 API 数据清洗为静态的标准数据
  parse: (rawData: unknown) => UnifiedPost

  // 动作：每个动作都应该返回标准结构
  fetchPostDetail: (postId: string) => Promise<UnifiedPost>

  // 抽象流：屏蔽 cursor/page 差异
  fetchUserTimeline: (userId: string) => AsyncIterableIterator<UnifiedPost>
}
```

#### Provider 注册中心

类似于 `ApiRegistry`，我们需要一个专门的注册中心来管理这些 Provider。

```typescript
// src/core/provider-registry.ts
export class ProviderRegistry {
  private providers: Map<string, ISNSProvider> = new Map()
  // ... constructor & logger ...

  public register(name: string, provider: ISNSProvider): void {
    if (this.providers.has(name)) {
      this.logger.warn(`Provider '${name}' is already registered.`)
      return
    }
    this.providers.set(name, provider)
  }

  public get(name: string): ISNSProvider {
    const provider = this.providers.get(name)
    if (!provider) {
      throw new Error(`Provider '${name}' not found. Make sure the plugin is loaded.`)
    }
    return provider
  }
}
```

### 2.3 实战：实现 `WeiboProvider`

我们通过引入 `WeiboParser` 将数据清洗逻辑从 Provider 中剥离，并使用 `IHttpClient` 处理网络请求。

**WeiboParser (专门负责脏活累活)**

```typescript
// src/plugins/weibo/parser.ts
import { MediaResource, UnifiedPost } from '../../types/model'

/**
 * 专门处理微博复杂的嵌套逻辑
 */
export class WeiboParser {
  /**
   * 将微博 API (m.weibo.cn 或 weibo.com/ajax) 的原始 JSON 转为标准范式
   */
  public toUnifiedPost(raw: any): UnifiedPost {
    // 1. 处理被转发的微博 (递归解析)
    let repostContext = null
    if (raw.retweeted_status) {
      repostContext = {
        isRepost: true,
        repostOf: this.toUnifiedPost(raw.retweeted_status) // 递归调用
      }
    }

    // 2. 处理多媒体
    const attachments = this.extractMedia(raw)

    // 3. 处理长文本
    const contentText = raw.isLongText ? (raw.longTextContent || raw.text_raw) : raw.text_raw

    return {
      id: raw.idstr, // 简化示例
      content: contentText,
      // ... 其他字段映射
      attachments,
      context: {
        isReply: !!raw.in_reply_to_status_id,
        ...repostContext
      }
    }
  }

  private extractMedia(raw: any): MediaResource[] {
    // ... 提取图片和视频逻辑 ...
    return []
  }
}
```

**WeiboProvider (只负责流程)**

```typescript
// src/plugins/weibo/provider.ts
import { ISNSProvider, UnifiedPost } from '../../types'
import { WeiboParser } from './parser'

export class WeiboProvider implements ISNSProvider {
  platformName = 'weibo'
  private parser = new WeiboParser()

  constructor(
    private client: IHttpClient, // 注入增强后的 HTTP Client
    private config: WeiboConfig
  ) {}

  parse(rawData: unknown): UnifiedPost {
    return this.parser.toUnifiedPost(rawData)
  }

  async fetchPostDetail(postId: string): Promise<UnifiedPost> {
    const response = await this.client.get(`https://weibo.com/ajax/statuses/show?id=${postId}`)
    return this.parse(response)
  }

  /**
   * 实现 AsyncIterator 使得上层代码可以用 for await...of 遍历
   * 这里解决了最头疼的“翻页”问题
   */
  async* fetchUserTimeline(userId: string): AsyncIterableIterator<UnifiedPost> {
    let sinceId: string | undefined
    let page = 1

    while (true) {
      // 1. 构建请求
      const params = new URLSearchParams({
        uid: userId,
        feature: '0',
        page: page.toString(),
        since_id: sinceId || ''
      })

      // 2. 发送请求 (重试、代理、Cookie 都在 client 内部处理)
      const response = await this.client.get(`https://weibo.com/ajax/statuses/mymblog?${params}`)

      if (!response.data || !response.data.list || response.data.list.length === 0) {
        break // 结束迭代
      }

      // 3. 处理数据并 Yield
      for (const rawItem of response.data.list) {
        try {
          // 在这里做运行时校验
          yield this.parser.toUnifiedPost(rawItem)
        }
        catch (e) {
          // Log parsing error
        }
      }

      sinceId = response.data.since_id
      page++

      // 注意：这里没有 sleep。
      // 速率控制由 this.client 内部的 RateLimitMiddleware 统一接管
    }
  }
}
```

// src/plugins/weibo/index.ts
export function createWeiboPlugin(config: WeiboConfig): Plugin {
  return {
    name: 'weibo-provider',
    setup(context) {
      const provider = new WeiboProvider(context.httpClient, config);
      context.providers.register('weibo', provider);
    }
  };
}
```

## 三、 钩子系统：流程中的自由插槽

（Hook 系统保持不变，它是连接各个生命周期的胶水。现在 Hook 可以更多地用于监控 Provider 的行为，例如在 `onData` 钩子中接收到的将是标准的 `UnifiedPost` 数据。）

### `Hookable`：并联与串联

```typescript
type Listener = (data: any) => Promise<void> | void
type WaterfallListener = (data: any) => Promise<any> | any

export class Hookable {
  private hooks: Record<string, Listener[]> = {}

  public on(name: string, listener: Listener): void {
    if (!this.hooks[name]) {
      this.hooks[name] = []
    }
    this.hooks[name].push(listener)
  }

  public async call(name: string, ...args: any[]): Promise<void> {
    const listeners = this.hooks[name] || []
    await Promise.all(listeners.map(fn => fn(...args)))
  }

  public async waterfall(name: string, initialValue: any): Promise<any> {
    let value = initialValue
    const listeners = this.hooks[name] || []
    for (const fn of listeners) {
      value = await fn(value)
    }
    return value
  }
}
```

## 四、 插件协作：基于 Provider 的任务编排

有了 `Provider`，我们的任务插件不再需要关心 HTTP 请求细节或解析逻辑，只需专注于业务流程的编排。

### 示例：获取帖子及其评论

```typescript
function createFetchPostAndCommentsTaskPlugin(): Plugin {
  return {
    name: 'task-fetch-post-comments',
    setup(context) {
      const execute = async ({ postId }: { postId: string }) => {
        const weibo = context.providers.get('weibo')
        const logger = context.getLogger('task:fetch')

        // 1. 获取帖子详情 (返回标准 UnifiedPost)
        const post = await weibo.getPost(postId)
        logger.info(`Fetched post: ${post.text.substring(0, 20)}...`)

        // 2. 触发数据钩子 (用于持久化等)
        await context.hooks.call('onData', { type: 'post', data: post })

        // 3. 如果支持评论抓取，则获取评论
        if (weibo.hasCapability('comments')) {
          const commentsResult = await weibo.getComments(postId)
          for (const comment of commentsResult.items) {
            await context.hooks.call('onData', { type: 'comment', data: comment })
          }
        }
      }

      // 注册任务
      context.apis.register('task:fetchPostWithComments', { execute }, 'task-plugin')
    },
  }
}
```

## 五、 Parser 的艺术：Provider 内部的归一化引擎

虽然 `DataMapper` 和 Schema 配置依然存在，但它们现在主要作为 Provider 内部的工具使用，确保产出数据的规范性。

### `createDataMapper`：通用的数据转换引擎

我们提供一个强大的工具函数`createDataMapper`，它接收一个“基础模式”和一套“转换规则”，生成一个最终的映射函数。

```typescript
interface MapperOptions<T> {
  // 源数据字段 -> 目标字段的映射
  mapping?: Record<string, string>
  // 需要转换值的字段
  transform?: Record<string, (value: any, source: any) => any>
  // 需要剔除的字段
  omit?: string[]
}

export function createDataMapper<T>(schema: any, options: MapperOptions<T> = {}) {
  // ... 实现细节 ...
  return (source: any): T => {
    // 1. 基础字段拷贝
    // 2. 应用映射 rename
    // 3. 应用 transform
    // 4. 应用 omit
    return result as T
  }
}
```

## 六、 构建生产级应用：错误处理与日志系统

（保持原有设计，Crawler 的健壮性依赖于分层的异常处理策略。）

### 分层异常处理策略

*   **Provider 层**：处理平台特定的错误（如 API 变更、HTML 结构改变），抛出标准化的 `NetworkError` 或 `ParseError`。
*   **Task 层**：捕获 Provider 抛出的错误，决定是重试（Retry）、跳过（Skip）还是终止任务。
*   **Core 层**：作为最后的防线，捕获未处理异常，记录日志并优雅关闭。

## 七、 扩展框架能力：高级架构模式

### 7.1 有状态操作与 Session 管理

Session 管理可以实现为一个特殊的 Plugin，通过 Hook 注入到 Provider 的 Fetcher 环节中。

### 7.2 大规模并发与流式处理

得益于 `AsyncIterator` 的引入，并发控制变得更加简单。我们可以使用 `for await...of` 配合并发池来处理数据流。

```typescript
// 伪代码示例：流式消费并并发处理
const stream = weibo.getUserFeedStream('uid_123')
const queue = new PQueue({ concurrency: 5 })

for await (const post of stream) {
  await queue.add(async () => {
    await processPost(post)
  })
}
```

# 八、 可观测性工程：构建不撒谎的日志系统

在构建框架级 SDK 时，传统的 `logger.info('Starting...')` 和 `logger.error('Failed')` 是不够的。在高达数千并发的爬虫任务中，离散的日志流只会形成噪音，无法还原现场。

我们需要借鉴**Wide Events（宽事件）**和**结构化日志**的理念，将日志系统从“文本记录”升级为“数据分析数据源”。

## 9.1 核心原则：Context Over Text

我们拒绝在代码深处随意打印无上下文的字符串。所有的遥测数据（Telemetry）必须依附于一个贯穿请求生命周期的**上下文（Context）**。

在 Node.js 环境下，我们将使用 `AsyncLocalStorage` 来隐式传递这个上下文，避免函数参数爆炸。

### 基础设施：`TelemetryContext`

```typescript
// src/core/telemetry/store.ts
import { AsyncLocalStorage } from 'node:async_hooks'

export interface TelemetryState {
  // 标识维度 (Cardinality Fields)
  traceId: string
  taskId: string
  platform: string
  targetUserId?: string
  resourceId?: string

  // 性能维度
  startTime: number
  networkDuration: number
  parseDuration: number

  // 业务维度
  proxy?: string
  retryCount: number
  itemsExtracted: number

  // 结果维度
  status: 'pending' | 'success' | 'failed' | 'skipped'
  error?: {
    code: string
    message: string
    stack?: string
  }
}

// 单例存储，用于跨调用栈共享状态
export const telemetryStore = new AsyncLocalStorage<Map<string, any>>()
```

## 9.2 实施策略：从 Log Lines 到 Canonical Log Lines

我们不再记录过程（Process），而是记录结果（Outcome）。我们要实现的是：**一个网络请求/一个处理单元，对应一条宽日志（Canonical Log Line）**。

### 封装 `instrument` 高阶函数

我们不希望开发者手动记录开始和结束，而是提供一个装饰器或包装函数来自动完成“宽事件”的构建与发射。

```typescript
// src/core/telemetry/instrument.ts
import { randomUUID } from 'node:crypto'
import { Logger } from '../../types'
import { telemetryStore } from './store'

export function instrument<T, Args extends any[]>(
  operationName: string,
  logger: Logger,
  fn: (...args: Args) => Promise<T>
) {
  return async (...args: Args): Promise<T> => {
    const state = new Map<string, any>()

    // 初始化上下文元数据
    state.set('trace_id', randomUUID())
    state.set('operation', operationName)
    state.set('start_time', Date.now())

    // 自动捕获高基数参数 (例如 args[0] 是 userId)
    if (typeof args[0] === 'string')
      state.set('arg_primary', args[0])

    // 进入异步上下文
    return telemetryStore.run(state, async () => {
      try {
        const result = await fn(...args)
        state.set('status', 'success')
        return result
      }
      catch (err: any) {
        state.set('status', 'error')
        state.set('error_type', err.name)
        state.set('error_message', err.message)
        // 关键：保留错误现场，而不是仅仅打印堆栈
        state.set('error_context', JSON.stringify(err.context || {}))
        throw err
      }
      finally {
        const duration = Date.now() - state.get('start_time')
        state.set('duration_ms', duration)

        // 最终发射：一条包含所有信息的结构化 JSON
        // 这里将 Map 转换为 Object 输出
        logger.info(Object.fromEntries(state), `[${operationName}] completed`)
      }
    })
  }
}
```

## 9.3 埋点规范：高基数数据的注入

在 `WeiboProvider` 或其他插件的深层逻辑中，我们不再直接调用 logger，而是向当前的 store 中注入数据。这使得底层逻辑与日志输出解耦。

```typescript
// src/plugins/weibo/provider.ts
import { telemetryStore } from '../../core/telemetry/store'

export class WeiboProvider implements ISNSProvider {
  async fetchPostDetail(postId: string): Promise<UnifiedPost> {
    const store = telemetryStore.getStore()

    // 1. 注入业务标识 (High Cardinality)
    // 这些数据对于排查特定 User 或 Post 的问题至关重要
    store?.set('platform', 'weibo')
    store?.set('resource_id', postId)

    // 2. 记录网络层细节
    // 注意：具体的代理信息现在由 HttpClient 管理，这里演示如何在业务层注入额外上下文
    // store?.set('network_proxy', ...)

    const startFetch = Date.now()
    // 使用注入的 client 发送请求
    const raw = await this.client.get(`https://weibo.com/ajax/statuses/show?id=${postId}`)

    // 3. 记录细分耗时
    store?.set('network_latency_ms', Date.now() - startFetch)

    // 4. 记录数据质量指标
    if (!raw.text_raw) {
      store?.set('data_quality_warning', 'empty_content')
    }

    return this.parse(raw)
  }
}
```

## 9.4 错误处理的上下文增强

当发生错误时，`Error` 对象本身应该携带上下文。不要抛出简单的 `new Error('Timeout')`。

```typescript
// src/types/errors.ts
export class CrawlerError extends Error {
  constructor(
    message: string,
    public code: string,
    public context: Record<string, any> = {}
  ) {
    super(message)
    this.name = 'CrawlerError'
  }
}

// 使用示例
if (response.status === 418) {
  // 能够回答：哪个账号？哪个IP？哪个URL？
  throw new CrawlerError('Anti-Crawler Triggered', 'IP_BANNED', {
    ip: currentProxy.ip,
    url: targetUrl,
    weibo_uid: currentUser.id
  })
}
```

## 9.5 最终效果：从搜索到查询

通过上述改造，我们的日志将从不可读的文本流转变为可查询的数据表。当开发者遇到问题时，他们不再是全文搜索 "Error"，而是运行结构化查询：

**旧模式（Grep）：**
`grep "Error" crawler.log | grep "12345"`
> 结果：大量碎片化信息，不知道是哪次重试失败的，也不知道当时用了什么代理。

**新模式（Query）：**
```json
{
  "operation": "task:fetch_user_feed",
  "resource_id": "12345",
  "status": "error",
  "duration_ms": { "$gt": 5000 }
}
```

**一条典型的 SDK 运行日志（Wide Event）：**

```json
{
  "level": "info",
  "time": "2025-07-13T10:00:00.123Z",
  "msg": "[task:fetch_user_feed] completed",
  "trace_id": "a1b2-c3d4-e5f6",
  "operation": "task:fetch_user_feed",
  "platform": "weibo",
  "resource_id": "user_10086",
  "arg_cursor": "since_id_999",
  "network_proxy": "192.168.1.10:8888",
  "network_latency_ms": 450,
  "items_extracted": 15,
  "parse_strategy": "v2_ajax_renderer",
  "retry_count": 2,
  "status": "success",
  "duration_ms": 1205
}
```

## 八、 将理论付诸实践：用户配置与启动

最终，用户的配置文件将变得非常简洁，只需关注业务逻辑。

### 用户配置文件 (`user-config.ts`)

```typescript
import { createDatabasePlugin } from './plugins/database'
import { createWeiboPlugin } from './plugins/weibo'
import { defineConfig } from './sdk'

export default defineConfig({
  logLevel: 'debug',
  plugins: [
    // 1. 注册能力 Provider
    createWeiboPlugin(),

    // 2. 注册数据处理插件
    createDatabasePlugin({
      url: process.env.DATABASE_URL
    }),

    // 3. 自定义 Hook
    {
      name: 'logger-plugin',
      setup(context) {
        context.hooks.on('onData', async ({ type, data }) => {
          console.log(`[${type}] Saved: ${data.id}`)
        })
      }
    }
  ]
})
```

### 任务调度 (`run-service.ts`)

```typescript
import { Crawler } from './core/crawler'
import config from './user-config'

async function main() {
  const crawler = new Crawler(config)
  await crawler.setup()

  // 获取 Weibo Provider 实例
  const weibo = crawler.context.providers.get('weibo')

  // 使用流式接口抓取特定用户的时间线
  const userId = '12345678'
  console.log(`Start crawling user ${userId}...`)

  try {
    for await (const post of weibo.fetchUserTimeline(userId)) {
      // 数据已经标准化，直接使用
      console.log(`Post: ${post.id} - ${post.content}`)

      // 数据持久化通常通过 Hook 在 Provider 内部或外部触发，
      // 这里也可以手动处理特殊逻辑
      // if (post.metrics.likes > 10000) { ... }
    }
  }
  catch (err) {
    console.error('Crawl failed:', err)
  }
}

main()
```

## 九、 DX (开发者体验) 极致优化

为了让这个 SDK 好用，我们需要解决“调试难”和“配置烦”的问题。

### 9.1 REPL (Read-Eval-Print Loop) 调试模式
爬虫开发最痛苦的是改完代码要跑整个流程。SDK 应该提供一个 CLI 交互模式。
```bash
# 开发者可以直接调用特定 Provider 的特定方法进行测试
$ my-sns-sdk debug weibo fetchPostDetail --id 123456789
```

### 9.2 类型推导的钩子 (Type-Safe Hooks)
使用 TypeScript 的泛型，让开发者在写 Hook 时能获得完整的代码补全。

```typescript
// src/core/hooks.ts
export interface HookMap {
  'crawler:start': (ctx: CrawlerContext) => void
  'data:extract': (payload: { platform: string, data: UnifiedPost }) => void // 这里的 data 是强类型的
  'network:error': (error: NetworkError) => void
}

// 在 UserConfig 中
export default defineConfig({
  hooks: {
    'data:extract': async ({ platform, data }) => {
      // IDE 会自动提示 data.id
      console.log(`[${platform}] ${data.id} extracted`)
    }
  }
})
```

### 9.3 错误快照 (Error Snapshots)
当 Parser 失败时，不仅要 Log，还要自动把导致失败的 **原始 JSON** Dump 到一个 `.json` 文件中。这样开发者可以直接拿到这就数据去复现 bug，而不需要重新去抓（可能抓不到了）。

## 十、 最终的结论

通过引入 **Provider Pattern** 和 **Async Iterator**，我们将微博爬虫 SDK 升级为了一个真正的通用 SNS 数据框架。

1.  **统一性**：`ISNSProvider` 屏蔽了底层平台的差异，让业务逻辑（入库、分析）可以复用。
2.  **易用性**：流式接口（Streams）消除了分页和游标管理的复杂性，极大地提升了开发者体验（DX）。
3.  **规范性**：强制的数据归一化（Normalization）和 Schema 校验，确保了系统数据的质量。

这套架构不仅适用于微博，更为接入 Twitter、小红书等其他平台打下了坚实的基础，真正实现了“从脚本工具到框架”的跨越。
