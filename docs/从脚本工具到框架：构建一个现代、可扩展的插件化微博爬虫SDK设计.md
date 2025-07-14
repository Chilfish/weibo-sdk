---
title: 从脚本工具到框架的演进
created: 2025-07-13
source: Cherry Studio
tags:
---

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

如果`Crawler`是大脑，`CrawlerContext`就是连接所有器官的血液。它是一个贯穿整个应用生命周期的对象，负责携带配置、共享状态、并提供核心服务（如 API 注册中心、钩子系统、日志等）。

```typescript
import pino from 'pino'
// src/core/context.ts
import { InternalAPIs, Logger, UserConfig } from '../types'
import { ApiRegistry } from './api-registry'
import { Hookable } from './hookable'

export class CrawlerContext {
  public config: UserConfig
  public hooks: Hookable
  public readonly apis: ApiRegistry<InternalAPIs>
  private readonly rootLogger: Logger
  // 为状态管理等高级功能预留位置
  [key: string]: any

  constructor(userConfig: UserConfig) {
    this.config = userConfig
    this.hooks = new Hookable()
    this.apis = new ApiRegistry<InternalAPIs>(this)

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

`Crawler`的`setup`方法会严格按照`pre` -> `normal` -> `post`的顺序执行插件，确保了行为的可预测性。

### 2.2 API 注册中心：安全可靠的插件通信

插件之间如何通信？直接在`context`上挂载属性会导致命名冲突和混乱。我们引入一个健壮的`ApiRegistry`来管理所有插件暴露的 API，它提供了比简单赋值更具意图、更安全的操作。

```typescript
// src/core/api-registry.ts
export class ApiRegistry<T> {
  private apis: Partial<T> = {}
  private context: CrawlerContext
  private logger: Logger

  constructor(context: CrawlerContext) {
    this.context = context
    this.logger = context.getLogger('core:api-registry')
  }

  // 注册一个新API，如果已存在则会警告，防止意外覆盖
  public register<K extends keyof T>(name: K, api: T[K], pluginName: string): void {
    if (this.apis[name]) {
      this.logger.warn(
        `API '${String(
          name,
        )}' is already registered. It will NOT be overridden by a new registration from '${pluginName}'.`,
      )
      return
    }
    this.apis[name] = api
    if (this.context.config.debug) {
      this.logger.info(`API '${String(name)}' registered by plugin '${pluginName}'.`)
    }
  }

  public get<K extends keyof T>(name: K): T[K] | undefined {
    return this.apis[name]
  }

  // 包装/修改一个已有的API，这是实现功能增强（装饰）的核心
  public wrap<K extends keyof T>(
    name: K,
    wrapper: (originalApi: T[K]) => T[K],
    pluginName: string,
  ): void {
    const originalApi = this.get(name)
    if (!originalApi) {
      this.logger.warn(
        `Cannot wrap API '${String(
          name,
        )}' from plugin '${pluginName}' because it is not registered yet.`,
      )
      return
    }
    this.apis[name] = wrapper(originalApi)
    if (this.context.config.debug) {
      this.logger.info(`API '${String(name)}' wrapped by plugin '${pluginName}'.`)
    }
  }
}
```

所有插件间的交互都应通过`context.apis`进行，并由一份`InternalAPIs`类型定义来保证类型安全。

```typescript
// src/types.ts
export interface InternalAPIs {
  'fetcher': { fetch: (url: string, options?: any) => Promise<any> }
  'task:user-posts': { execute: (params: { userId: string, cookie: string }) => Promise<void> }
  // ... 其他API定义
}
```

### 2.3 实战：覆盖与增强`fetcher`

现在，我们可以优雅地解决“用 axios 替换内置 fetcher”的问题。

**SDK 内置的 Fetcher 插件（普通插件）：**

```typescript
// src/plugins/fetcher.ts
export function createFetcherPlugin(): Plugin {
  return {
    name: 'core-fetcher:fetch',
    setup(context) {
      const fetchApi = {
        /* ... fetch 实现 ... */
      }
      // 礼貌地注册，如果已被'pre'插件抢占，则不执行
      context.apis.register('fetcher', fetchApi, this.name)
    },
  }
}
```

**用户的 Axios Fetcher 插件（`pre`插件）：**

```typescript
import axios from 'axios'
// user-plugins/fetcher-axios.ts
import { definePlugin } from 'weibo-crawler-sdk'

export default definePlugin({
  name: 'custom-fetcher:axios',
  enforce: 'pre', // 确保在内置fetcher之前运行
  setup(context) {
    const fetchApi = {
      async fetch(url, options = {}) {
        const response = await axios({ url, ...options })
        return response.data
      },
    }
    context.apis.register('fetcher', fetchApi, this.name)
  },
})
```

**用户的重试插件（`post`插件）：**

如果用户只想在现有`fetcher`基础上增加重试逻辑，而不是替换它：

```typescript
// user-plugins/retry.ts
import { definePlugin } from 'weibo-crawler-sdk'

export default definePlugin({
  name: 'custom-retry',
  enforce: 'post', // 确保在所有fetcher注册后运行
  setup(context) {
    context.apis.wrap(
      'fetcher',
      (originalFetcher) => {
        // 返回一个被包装后的新API
        return {
          async fetch(...args) {
            let attempts = 0
            const retries = 3
            while (attempts < retries) {
              try {
                // 调用原始的fetch方法
                return await originalFetcher.fetch(...args)
              }
              catch (error) {
                attempts++
                if (attempts >= retries)
                  throw error
              }
            }
          },
        }
      },
      this.name,
    )
  },
})
```

通过`enforce`和`ApiRegistry`的组合，我们建立了一套清晰、可预测的插件协作模型。

## 三、 钩子系统：流程中的自由插槽

如果说 API 注册中心解决了插件间的“横向”通信，那么钩子系统就解决了对系统“纵向”流程的干预。

### `Hookable`：并联与串联

一个强大的钩子系统需要支持两种模式：

1.  **并联 (`call`)**：事件发生，通知所有监听者。适用于日志、数据存储等场景。
2.  **串联 (`waterfall`)**：数据像瀑布一样流经每个监听者，上一个的输出是下一个的输入。适用于数据转换、修改等场景。

```typescript
// src/core/hookable.ts
type Listener<T> = (payload: T) => void | Promise<void>
type WaterfallListener<T> = (payload: T) => T | Promise<T>

export class Hookable {
  private hooks: Record<string, Function[]> = {}

  public on<T>(name: string, listener: Listener<T>) {
    ;(this.hooks[name] = this.hooks[name] || []).push(listener)
  }

  public async call<T>(name: string, payload: T): Promise<void> {
    const listeners = (this.hooks[name] || []) as Listener<T>[]
    for (const listener of listeners) {
      await listener(payload)
    }
  }

  public async waterfall<T>(name: string, initialValue: T): Promise<T> {
    let value = initialValue
    const listeners = (this.hooks[name] || []) as WaterfallListener<T>[]
    for (const listener of listeners) {
      value = await listener(value)
    }
    return value
  }
}
```

### 实战：增量入库与数据转换

在任务插件中，我们可以利用钩子将核心逻辑与附加操作解耦。

```typescript
// src/plugins/task-user-posts.ts
// ... 在 execute 方法内部
while (hasMorePages) {
  // ... 获取并解析了一页的数据 `parsedPosts`

  // 1. 使用串联钩子，允许其他插件在入库前修改数据
  const finalPosts = await context.hooks.waterfall('transform:post', parsedPosts)

  // 2. 使用并联钩子，通知所有关心数据的插件（如数据库插件）
  await context.hooks.call('onData', {
    type: 'user-posts',
    data: finalPosts,
    source: { userId },
  })
}
```

一个用户插件可以这样用：

```typescript
// user-plugins/add-tags-plugin.ts
context.hooks.on('transform:post', (posts) => {
  return posts.map((post) => {
    post.tags = extractTags(post.text) // 为每个帖子增加一个 tags 字段
    return post
  })
})
```

用户的数据库插件只需监听`onData`即可：

```typescript
// user-plugins/database.ts
export default definePlugin({
  name: 'my-database-plugin',
  setup(context) {
    context.hooks.on('onData', async ({ type, data }) => {
      if (type === 'user-posts') {
        // ... 将 data 存入数据库 ...
      }
    })
  },
})
```

插件作者获得了在流程关键节点**修改数据**的能力，而不仅仅是观察。这解锁了无数种可能，比如数据清洗、内容审查、自动打标等。

## 四、 插件协作的两种模式：编排与编舞

一个简单的数据存储插件可以通过监听`onData`钩子与系统解耦，但这引出了一个更深层次的问题：当插件之间存在强依赖和顺序关系时，例如“必须先抓取微博详情，再用详情中的ID去抓取评论”，这种流程该如何优雅地实现？

对此，一个成熟的插件化框架应提供两种互补的协作模式：命令式的“编排”（Orchestration）与响应式的“编舞”（Choreography）。

### 编排模式：由任务插件作为流程指挥官

这是处理核心业务流程最直观和健壮的方式。其核心在于定义一个高阶的“任务插件”，该插件的唯一职责是按照预定逻辑，依次调用其他提供原子能力的“能力插件”。

*   **能力插件 (Utility Plugins)**：这些插件是基础服务的提供者，它们通过`context.apis.register`注册功能单一、明确的API，例如 `apis.weibo.getDetail(id)` 或 `apis.weibo.getComments(id)`。它们是被动的，不关心自己何时或被谁调用。
*   **任务插件 (Task/Orchestrator Plugin)**：这是业务流程的定义者。它显式地调用能力插件，处理它们之间的数据流转和依赖关系。

让我们看一个获取微博及其评论的任务插件：

```typescript
// plugins/tasks/fetch-post-and-comments.ts
export function createFetchPostAndCommentsTaskPlugin(): Plugin {
  return {
    name: 'task:fetch-post-and-comments',
    async setup(context) {
      const execute = async (params: { postId: string, cookie: string }) => {
        const logger = context.getLogger(`task:${this.name}:${params.postId}`)
        logger.info('Task started.')

        // 假设能力插件在 'weibo' 命名空间下注册了 API
        const weiboApi = context.apis.get('weibo')
        if (!weiboApi) {
          throw new Error('Weibo API provider plugin not found!')
        }

        // 步骤 1: 调用“详情”能力插件的 API
        const postDetail = await weiboApi.getDetail({
          id: params.postId,
          cookie: params.cookie,
        })
        logger.info('Fetched post detail.')

        // 关键的顺序和依赖点：使用上一步的结果作为下一步的输入
        // 步骤 2: 调用“评论”能力插件的 API
        const comments = await weiboApi.getComments({
          id: postDetail.id, // 依赖上一步获取的微博 ID
          cookie: params.cookie,
        })
        logger.info(`Fetched ${comments.length} comments.`)

        // 步骤 3: 组合数据并触发钩子，通知其他插件（如数据库插件）
        const fullPostData = { ...postDetail, comments }
        await context.hooks.call('onFullPostCrawled', { data: fullPostData })

        logger.info('Task finished successfully.')
        return fullPostData
      }

      // 将这个完整的“任务”注册为一个可执行的 API
      context.apis.register('task:fetchPostWithComments', { execute }, this.name)
    },
  }
}
```

这种模式下，业务流程清晰、可追溯，依赖关系是显式的。但它的缺点在于灵活性不足，若想在流程中间插入步骤，需修改任务插件本身。

### 编舞模式与混合模型：通过钩子实现极致解耦与扩展

为了弥补编排模式的不足，框架利用钩子系统实现了“编舞”模式。在该模式下，插件间互不知晓，通过监听和触发系统事件（钩子）进行协作。

一个更佳的实践是将两者结合。核心流程依然由任务插件**编排**，但在每个关键步骤之后，通过钩子暴露扩展点，允许其他插件进行**编舞**式的即兴扩展。

看一个改进版的任务插件：

```typescript
// plugins/tasks/fetch-post-and-comments-v2.ts (部分 execute 函数)
// ...
// 步骤 1: 获取详情
const postDetail = await weiboApi.getDetail({ id: params.postId, cookie: params.cookie })
// **扩展点 1**: 允许其他插件在获取评论前对详情数据进行修改或基于此触发操作
const finalDetail = await context.hooks.waterfall('weibo:beforeCommentFetch', postDetail)
await context.hooks.call('weibo:onDetailFetched', { data: finalDetail })

// 步骤 2: 获取评论
const comments = await weiboApi.getComments({ id: finalDetail.id, cookie: params.cookie })
const finalComments = await context.hooks.waterfall('weibo:commentsProcessing', comments)
// **扩展点 2**: 允许对评论数据进行处理
await context.hooks.call('weibo:onCommentsFetched', { data: finalComments, postId: finalDetail.id })

// 步骤 3: 组合与最终通知
const fullPostData = { ...finalDetail, comments: finalComments }
await context.hooks.call('weibo:onFullPostReady', { data: fullPostData })
// ...
```

在这种混合模型下，我们获得了两全其美的效果：核心业务逻辑稳定可控，同时系统通过钩子获得了极高的可扩展性。一个第三方插件可以监听`weibo:beforeCommentFetch`来决定是否要跳过评论获取，或监听`weibo:onFullPostReady`将数据发送到分析系统，而无需触碰任务插件的核心代码。

## 五、 Parser 的艺术：兼顾复用与定制

解析器（Parser）的设计是爬虫 SDK 中最考验 DX 的部分。我们采用一种**配置驱动**的策略，将通用逻辑与个性化需求分离。

### `createDataMapper`：通用的数据转换引擎

我们提供一个强大的工具函数`createDataMapper`，它接收一个“基础模式”和一套“转换规则”，生成一个最终的映射函数。

```typescript
// src/utils/mapper.ts

interface MapperOptions<T> {
  // 字段重命名，如 { screen_name: 'authorName' }
  mapping?: { [K in keyof T]?: string }

  // 选择需要的字段
  pick?: (keyof T)[]

  // 排除不需要的字段
  omit?: (keyof T)[]

  // 添加或转换字段，值为函数，接收整个原始item
  transform?: {
    [newField: string]: (rawItem: any) => any
  }
}

/**
 * 创建一个数据映射函数
 * @param baseSchema 定义如何从原始数据中提取基础字段
 * @param options 用户自定义的转换规则
 */
export function createDataMapper<T extends Record<string, any>>(
  baseSchema: { [K in keyof T]: (rawItem: any) => T[K] },
  options: MapperOptions<T> = {},
) {
  return (rawItem: any): Partial<T> => {
    let result: any = {}

    // 1. 根据 baseSchema 提取基础数据
    for (const key in baseSchema) {
      result[key] = baseSchema[key](rawItem)
    }

    // 2. 应用 transform，可以覆盖或新增字段
    if (options.transform) {
      for (const key in options.transform) {
        result[key] = options.transform[key](rawItem)
      }
    }

    // 3. 应用 mapping (重命名)
    if (options.mapping) {
      for (const oldKey in options.mapping) {
        const newKey = options.mapping[oldKey]
        if (newKey && result[oldKey] !== undefined) {
          result[newKey] = result[oldKey]
          delete result[oldKey]
        }
      }
    }

    // 4. 应用 pick/omit (字段筛选)
    if (options.pick) {
      result = Object.fromEntries(
        Object.entries(result).filter(([key]) => options.pick.includes(key as any)),
      )
    }
    else if (options.omit) {
      options.omit.forEach(key => delete result[key])
    }

    return result
  }
}
```

### 可复用的`baseSchema`与任务插件

我们将微博帖子等通用数据结构的解析逻辑定义为可复用的`baseSchema`。

```typescript
// src/parsers/schemas.ts
export const postBaseSchema = {
  id: (item: any) => item.idstr,
  text: (item: any) => item.text,
  authorId: (item: any) => item.user?.id,
  authorName: (item: any) => item.user?.screen_name,
  // ... 其他基础字段
}
```

任务插件在运行时，会结合`baseSchema`和用户的配置来创建解析器。

```typescript
import { postBaseSchema } from '../parsers/schemas'
// src/plugins/task-user-posts.ts (部分)
import { createDataMapper } from '../utils/mapper'

// ... 在 execute 方法中
// 从用户配置中获取针对此任务的 parser 选项
const parserOptions = context.config.parser?.userPosts || {}
const postMapper = createDataMapper(postBaseSchema, parserOptions)

const posts = rawData.data.list.map(postMapper)
```

### 用户的个性化配置

用户现在可以在`defineConfig`中轻松定制任何任务的输出字段，无需编写任何代码。

```typescript
// user-config.ts
export default defineConfig({
  parser: {
    userPosts: {
      // 对应 'task:user-posts' 任务
      mapping: { authorName: 'author' },
      omit: ['authorId'],
      transform: {
        platform: () => 'weibo',
        textLength: rawItem => rawItem.text.length,
      },
    },
  },
})
```

这种设计将复杂的解析逻辑配置化，极大地提升了 SDK 的易用性和灵活性。

## 六、 构建生产级应用：错误处理与日志系统

一个框架的价值不仅在于它能做什么，更在于它在面对现实世界的混乱（如网络波动、API变更）时表现得多么稳健。为此，我们需要一个分层的异常处理机制和一个结构化的日志系统。

### 分层异常处理策略

单一的全局`try...catch`无法优雅地应对所有情况。我们的框架采用三层防御体系，每层处理特定类型的异常。

**第一层：操作级容错 (Local Fault Tolerance)**

这用于处理可预期的、不应中断整个任务的局部失败，例如解析列表中某一项数据时出错。我们可以通过自定义错误类型，在循环内部捕获并跳过失败项。

```typescript
// src/errors.ts
// 一个特殊的错误类，用于流程控制，表示此项应被跳过
export class SkipItemError extends Error {
  constructor(message: string, public readonly cause?: Error, public readonly rawItem?: any) {
    super(message)
    this.name = 'SkipItemError'
  }
}

// 在任务插件的解析循环中使用
// ...
for (const rawPost of rawPosts) {
  try {
    parsedPosts.push(postMapper(rawPost))
  }
  catch (error) {
    if (error instanceof KnownParsingError) { // 假设 postMapper 会抛出此类型错误
      const logger = context.getLogger(`task:${this.name}`)
      logger.warn({ postId: rawPost.id, error: error.message }, 'Skipping item due to parsing error.')

      // 触发钩子，以便其他插件可以对跳过的项做记录或处理
      await context.hooks.call('onItemSkipped', {
        taskName: this.name,
        reason: new SkipItemError('Parsing failed', error, rawPost)
      })
    }
    else {
      // 未知错误，向上抛出
      throw error
    }
  }
}
// ...
```

**第二层：任务级重试 (Task-level Retry)**

对于影响整个任务但可能恢复的异常（如`cookie`失效、网络抖动），我们通过一个通用的重试插件来处理。该插件利用`context.apis.wrap`装饰所有任务的`execute`方法。

首先，定义可重试的错误类型，并让`fetcher`在遇到相应情况时抛出它们：
```typescript
// src/errors.ts
export class AuthenticationError extends Error { /* ... */ }
export class NetworkError extends Error { /* ... */ }
```

然后，创建一个核心重试插件：
```typescript
// src/core-plugins/retry.ts
export function createRetryPlugin(): Plugin {
  return {
    name: 'core:retry',
    enforce: 'post', // 确保在任务API注册后运行
    setup(context) {
      const logger = context.getLogger(this.name)
      const retryConfig = context.config.retry || { attempts: 3, delay: 1000 }

      // 遍历所有已注册的任务API
      const taskApis = context.apis.getAllApiNames().filter(name => name.startsWith('task:'))

      for (const apiName of taskApis) {
        context.apis.wrap(apiName, (originalApi) => {
          const originalExecute = originalApi.execute

          const newExecute = async (params: any) => {
            for (let attempt = 1; attempt <= retryConfig.attempts; attempt++) {
              try {
                return await originalExecute(params)
              }
              catch (error) {
                if (error instanceof AuthenticationError || error instanceof NetworkError) {
                  logger.warn({ task: apiName, attempt, error: error.message }, 'Task failed, retrying...')
                  if (error instanceof AuthenticationError) {
                    // 触发钩子，通知会话管理插件刷新凭证
                    await context.hooks.call('session:needsRefresh', { userId: params.userId })
                  }
                  if (attempt === retryConfig.attempts)
                    throw error
                  await new Promise(resolve => setTimeout(resolve, retryConfig.delay * attempt))
                }
                else {
                  throw error // 非可重试错误，立即失败
                }
              }
            }
          }
          return { ...originalApi, execute: newExecute }
        }, this.name)
      }
    }
  }
}
```

**第三层：全局钩子通知 (Global Error Hook)**

这是最后一道防线。`Crawler.run`方法会捕获所有未处理的异常，并调用`onTaskError`钩子，允许用户插件进行最终的处理，如记录到Sentry、发送邮件通知等。

```typescript
// user-plugins/sentry-reporter.ts
import * as Sentry from '@sentry/node'

export default definePlugin({
  name: 'sentry-reporter',
  setup(context) {
    if (context.config.sentryDsn) {
      Sentry.init({ dsn: context.config.sentryDsn })
      context.hooks.on('onTaskError', ({ taskName, error, context: taskContext }) => {
        Sentry.withScope((scope) => {
          scope.setTag('task_name', taskName)
          scope.setContext('task_context', taskContext)
          Sentry.captureException(error)
        })
      })
    }
  }
})
```

### 结构化与上下文感知的日志系统

为了便于调试和监控，日志必须是结构化的，并且包含丰富的上下文信息。我们通过在`CrawlerContext`中内置`pino`来实现这一点，并提供一个`getLogger(name)`方法。

`getLogger`的精髓在于它支持链式调用`.child()`来添加上下文，这在追踪复杂的任务执行流时至关重要。

```typescript
// 在任务执行器中使用
const taskLogger = context.getLogger(`task:user-posts`)
// 为每次具体的运行创建一个子 logger，自动附加 runId 和 userId
const runLogger = taskLogger.child({ runId: executionContext.runId, userId: params.userId })

runLogger.info('Task execution started.')
// JSON输出: {"level":30,"time":...,"name":"task:user-posts","runId":"167...","userId":"12345","msg":"Task execution started."}

runLogger.warn({ page: 3 }, 'Failed to fetch a page, but continuing.')
// JSON输出: {"level":40,"time":...,"name":"task:user-posts","runId":"167...","userId":"12345","page":3,"msg":"Failed to fetch a page, but continuing."}
```
通过这种方式，我们可以轻松地在日志系统中筛选出特定任务、特定用户或特定运行ID的所有相关日志，极大地简化了问题排查。

## 七、 扩展框架能力：高级架构模式

我们已经构建了一个可扩展、容错的框架。现在，让我们探索一些高级模式，以支持状态管理、大规模并发和动态工作流等复杂场景。

### 有状态操作：通过会话管理器处理身份认证

爬虫任务常常是有状态的，最典型的就是需要管理会过期的`cookie`。将这些状态逻辑硬编码在每个任务中是不可持续的。解决方案是在`CrawlerContext`中引入一个专门的“会话管理器”。

一个`session-manager`插件可以在`setup`阶段向`context`中注册一个`session`服务。

```typescript
// plugins/session-manager.ts
class SessionManager {
  // ... store, set, get, isExpired ...

  // 关键方法: 封装了状态检查和刷新逻辑
  public async getValidCookie(userId: string): Promise<string> {
    let session = this.store.get(userId)
    if (!session || this.isExpired(session)) {
      // session 无效，触发钩子请求刷新
      const newSession = await this.context.hooks.waterfall('session:refresh', { userId })
      this.set(userId, newSession)
      session = newSession
    }
    return session.cookie
  }
}

export function createSessionManagerPlugin(): Plugin {
  return {
    name: 'core:session-manager',
    enforce: 'pre',
    setup(context) {
      context.session = new SessionManager(context)
    }
  }
}
```

用户的登录插件只需监听`session:refresh`钩子并提供获取新`cookie`的逻辑即可。这样，任务插件的逻辑就从“我需要传入`cookie`去请求”简化为“我需要以`userId`的身份去请求”，状态管理的复杂性被完全隔离。

### 大规模并发：内置任务队列

当需要同时处理成百上千个任务时，顺序执行的`crawler.run()`显然不能满足性能要求。为此，我们在`Crawler`核心中内置一个基于`p-queue`的任务队列，并提供一个新的`submit`方法。

```typescript
// src/core/crawler.ts
import { PQueue } from 'p-queue'

export class Crawler {
  private taskQueue: PQueue
  // ...

  constructor(userConfig: UserConfig = {}) {
    // ...
    this.taskQueue = new PQueue({
      concurrency: userConfig.concurrency || 5, // 从配置读取并发数
    })
  }

  // ... run() 方法保持不变，用于立即执行

  /**
   * 提交一个任务到队列中，由队列调度执行。返回一个在任务完成时 resolve 的 Promise。
   */
  public submit<T extends keyof InternalAPIs>(
    taskName: T,
    params: Parameters<InternalAPIs[T]['execute']>[0],
  ): Promise<any> { // 返回值可以是任务的执行结果
    return this.taskQueue.add(() => {
      // 这里的执行逻辑与 run 方法类似，但被队列包裹
      // ...（省略了与run方法重复的上下文创建和错误处理逻辑）
      return taskPluginAPI.execute(executionContext)
    })
  }

  // 提供等待队列完成的方法
  public async onIdle(): Promise<void> {
    await this.taskQueue.onIdle()
  }
}
```
`run`方法适用于单个、高优先级的任务，而`submit`方法则用于批量提交任务，框架会自动根据配置的并发数来控制执行，从而实现高效的并发处理。

### 7.3 动态与分支工作流：由任务衍生任务

更复杂的场景是动态工作流，例如“爬取用户A的关注列表，然后为每个关注者衍生出一个新的爬取任务”。这意味着一个任务的执行结果会动态地生成新的任务。

解决方案是将`submit`方法注入到任务的执行上下文中，允许任务自身成为任务的派发者。

```typescript
// 在 Crawler 的 submit/run 方法内部，创建 executionContext 时：
const executionContext = {
  ...params,
  // 关键: 注入一个让任务可以提交新任务的接口
  submitTask: (taskName: any, params: any) => this.submit(taskName, params),
}

// ... 然后将 executionContext 传给 execute 方法

// 一个动态工作流任务的例子
// plugins/tasks/explore-followers-task.ts
async function execute(context: { userId: string, submitTask: Function }) {
  const { userId, submitTask } = context

  // 1. 获取关注列表
  const followers = await apis.weibo.getFollowers(userId)

  // 2. 为每个关注者，衍生出一个新的“获取资料”任务
  const profileTasks = followers.map(follower =>
    submitTask('task:fetch-profile', { userId: follower.id })
  )

  // 等待所有衍生的资料获取任务完成
  await Promise.all(profileTasks)
}
```
通过这种模式，框架从一个线性的任务执行器，演变为一个能够构建和执行复杂任务图（Task Graph）的强大引擎，为实现探索性爬取等高级策略铺平了道路。

## 八、 将理论付诸实践：一个生产级爬取场景

理论的价值最终体现在实践中。现在，我们将前面讨论的所有高级概念——任务编排、分层错误处理、状态管理、并发队列——整合到一个完整的端到端场景中。

**场景描述**：创建一个健壮的自动化服务。该服务使用一个`cookie`池来为一组指定微博用户抓取最新的微博和评论。它需要支持并发抓取，能自动处理`cookie`失效，将抓取失败的任务自动重试，捕获所有未处理的异常并上报到Sentry，同时将成功的数据增量存入数据库。
### 用户的自定义数据库插件 (`my-database-plugin.ts`)

这个插件是用户为了满足自身存储需求而编写的。它完美地展示了插件如何通过钩子与系统核心逻辑解耦。

```typescript
import { PrismaClient } from '@prisma/client' // 使用 Prisma 作为ORM示例
// my-database-plugin.ts
import { definePlugin } from './src/sdk'

export function createMyDatabasePlugin() {
  return definePlugin({
    // 使用 definePlugin 获得类型提示
    name: 'my-database-plugin',

    async setup(context) {
      const logger = context.getLogger(this.name)
      const prisma = new PrismaClient()
      let isConnected = false

      // 在setup阶段连接数据库
      try {
        await prisma.$connect()
        isConnected = true
        logger.info('Database connection established.')
      }
      catch (error) {
        logger.error({ error }, 'Failed to connect to the database.')
      }

      // 监听 onData 钩子，这是实现增量入库的关键
      context.hooks.on('onData', async ({ type, data, source }) => {
        if (type === 'user-posts' && isConnected) {
          logger.info(`Received ${data.length} posts from user ${source.userId}. Saving...`)
          try {
            // 假设 prisma schema 中有 Post 模型
            await prisma.post.createMany({
              data,
              skipDuplicates: true, // 避免重复插入
            })
          }
          catch (error) {
            logger.error({ error, userId: source.userId }, 'Failed to save posts to database.')
          }
        }
      })

      // 确保程序结束时断开连接 (需要一个onEnd或onShutdown钩子)
      context.hooks.on('onShutdown', async () => {
        if (isConnected) {
          await prisma.$disconnect()
          logger.info('Database connection closed.')
        }
      })
    },
  })
}
```

### 用户配置文件 (`user-config.ts`)

用户的配置现在反映了系统的全部功能：

```typescript
import { createMyDatabasePlugin } from './plugins/my-database-plugin'
import { createSentryReporterPlugin } from './plugins/sentry-reporter-plugin'
// user-config.ts
import { defineConfig } from './src/sdk'

export default defineConfig({
  // 开启调试模式，可以看到详细的内部流程日志
  debug: true,
  logLevel: 'info',
  concurrency: 10, // 设置并发数为 10

  // 配置重试策略
  retry: {
    attempts: 3,
    delay: 2000,
  },

  // 针对特定任务的解析器配置
  parser: {
    // ...
  },

  // 加载所有插件，注意加载顺序
  plugins: [
    createMyDatabasePlugin(), // 提供数据存储逻辑，响应 onData 钩子
    createSentryReporterPlugin({
      sentryDsn: 'YOUR_SENTRY_DSN_HERE', // Sentry DSN for error reporting
    }),
  ],
})
```

### 任务调度与执行脚本 (`run-service.ts`)

驱动脚本现在使用`submit`来派发任务，并依赖会话管理器处理认证，而非手动传递`cookie`。

```typescript
// run-service.ts
import { Crawler } from './src/core/crawler'
import config from './user-config'

const usersToCrawl = ['11111', '22222', '33333',]

async function main() {
  console.log('Initializing crawler service...')
  const crawler = new Crawler(config)
  await crawler.setup()
  console.log('Service setup complete. Starting crawl cycle...')

  // 使用 map 提交所有任务到队列，不在此处 await
  const tasks = usersToCrawl.map(uid =>
    crawler.submit('task:fetchPostWithComments', { userId: uid })
      .catch((error) => {
        // submit 返回的 promise reject时，在这里处理单个任务的最终失败
        // Sentry 插件已经记录了错误，这里可以做额外处理
        console.error(`Crawl failed permanently for user ${uid}:`, error.message)
      })
  )

  // 等待所有已被提交到队列的任务完成
  await Promise.all(tasks)

  // 或者，如果只想等待队列变空
  // await crawler.onIdle();

  console.log('Crawl cycle finished.')

  // 优雅地处理进程退出
  process.on('SIGINT', async () => {
    console.log('Shutting down...')
    await crawler.context.hooks.call('onShutdown', {}) // 通知插件清理资源
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('A critical error occurred in the main process:', error)
  process.exit(1)
})
```

这个最终的例子生动地展示了框架的强大之处：`run-service.ts`脚本的逻辑极其简单，它只负责“定义要抓取的目标”和“提交任务”。所有复杂的细节——并发控制、状态管理、重试、错误上报、数据存储——都被优雅地封装在各自独立的插件中，由框架在幕后自动协调。这正是将“工具”重塑为“框架”的真正价值所在。

## 九、 最终的结论

我们完成了一次意义深远的架构演进。从一个功能固化的脚本工具，我们构建了一个以插件为核心、能够应对复杂现实场景、并拥有极致开发者体验的系统框架。

这个框架的核心优势在于其深刻的设计哲学：

-   **控制反转 (IoC)**：框架负责生命周期、任务队列、并发控制和流程调度，用户通过插件和配置来填充具体业务逻辑。
-   **协作模式**：同时支持命令式的**编排**（由任务插件定义主流程）和响应式的**编舞**（由钩子系统实现解耦扩展），兼具清晰性与灵活性。
-   **关注点分离**：核心爬取逻辑、状态管理（会话）、错误处理（重试、上报）、数据持久化等被彻底解耦，可以独立开发、测试和替换。
-   **生产级健壮性**：内置了分层异常处理、结构化日志和可配置的重试机制，为构建稳定可靠的应用提供了坚实基础。
-   **开发者体验 (DX) 驱动**：从`defineConfig`到`definePlugin`，从上下文感知的日志记录到高度抽象的任务提交接口，每一个设计细节都旨在降低开发者的心智负担，使其能专注于业务逻辑本身。

我们所构建的，已不仅仅是一个更强大的爬虫SDK。它是一个稳固的平台，一个能够应对大规模、动态化、有状态需求的强大引擎，一个能够吸引社区力量、不断生长和演化的生态系统的开端。这，正是将一个个人项目推向一个成功的开源项目的必由之路。
