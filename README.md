# Weibo SDK

一个现代化、可扩展的插件化微博爬虫SDK，专为构建高质量、可维护的微博数据采集系统而设计。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-8.0+-orange.svg)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🌟 特性

- **🔌 插件化架构**: 模块化设计，易于扩展和自定义
- **🎯 类型安全**: 完整的 TypeScript 支持，优秀的开发体验
- **🔄 钩子系统**: 事件驱动的架构，支持灵活的数据处理流水线
- **📡 HTTP 客户端**: 基于 axios 的智能重试和错误处理
- **📋 结构化日志**: 基于 Winston 的分层日志系统
- **⚡ 高性能**: 内置并发控制和速率限制
- **🛡️ 生产就绪**: 完善的错误处理、优雅关闭和资源管理

## 📦 包结构

这是一个 pnpm monorepo 项目，包含以下核心包：

- **[@weibo-sdk/core](./packages/core/)** - 核心框架和插件系统
- **[@weibo-sdk/plugins](./packages/plugins/)** - 通用插件集合（HTTP客户端、重试等）
- **[@weibo-sdk/weibo](./packages/weibo/)** - 微博专用插件和工具

## 🚀 快速开始

### 安装

```bash
# 安装所有依赖
pnpm install

# 构建所有包
pnpm run build
```

### 基础用法

```typescript
import { Crawler, defineConfig } from '@weibo-sdk/core'
import { createHttpClientPlugin, createRetryPlugin } from '@weibo-sdk/plugins'
import { createWeiboPlugin, createWeiboUserTaskPlugin } from '@weibo-sdk/weibo'

// 创建爬虫配置
const config = defineConfig({
  plugins: [
    createHttpClientPlugin({
      timeout: 30000,
      retries: 3
    }),
    createRetryPlugin({
      maxRetries: 3,
      exponentialBackoff: true
    }),
    createWeiboPlugin({
      cookie: 'your-weibo-cookie-here',
      rateLimit: {
        requestsPerSecond: 1,
        burstLimit: 5
      }
    }),
    createWeiboUserTaskPlugin({
      includePosts: true,
      maxPosts: 20
    })
  ],
  logger: {
    level: 'info',
    format: 'simple'
  }
})

// 创建并运行爬虫
const crawler = new Crawler(config)

await crawler.setup()
await crawler.run({
  userId: '1234567890', // 目标用户ID
  includePosts: true,
  maxPosts: 50
})
await crawler.stop()
```

### 获取用户信息（最小示例）

```typescript
import { Crawler, defineConfig } from '@weibo-sdk/core'
import { createHttpClientPlugin } from '@weibo-sdk/plugins'
import { createWeiboPlugin } from '@weibo-sdk/weibo'

const crawler = new Crawler(defineConfig({
  plugins: [
    createHttpClientPlugin(),
    createWeiboPlugin()
  ]
}))

await crawler.setup()

// 直接调用API获取用户信息
const getUserProfile = crawler.context.apis.get('weibo:getUserProfile')
const user = await getUserProfile('1234567890')

console.log(`用户: ${user.name} (@${user.screen_name})`)
console.log(`粉丝数: ${user.followers_count}`)

await crawler.stop()
```

## 🏗️ 核心架构

### 插件系统

插件是扩展爬虫功能的核心方式，每个插件都实现简单的接口：

```typescript
import type { Plugin } from '@weibo-sdk/core'

const myPlugin: Plugin = {
  name: 'my-plugin',
  setup: (context) => {
    // 注册API
    context.apis.register('myApi', async (data) => {
      return await processData(data)
    })

    // 监听事件
    context.hooks.on('dataReceived', async (data) => {
      await handleData(data)
    })
  }
}
```

### 钩子系统

支持两种执行模式：

```typescript
// 并行执行 - 所有监听器同时运行
await context.hooks.call('onData', data)

// 瀑布流 - 数据依次转换
const transformed = await context.hooks.waterfall('transform', originalData)
```

### API 注册中心

插件间安全通信的机制：

```typescript
// 注册API
context.apis.register('fetch', async (url) => {
  return await httpClient.get(url)
})

// 使用API
const fetcher = context.apis.get('fetch')
const data = await fetcher('https://api.example.com/data')

// 包装现有API
context.apis.wrap('fetch', (originalFetch) => {
  return async (url) => {
    console.log('正在获取:', url)
    return await originalFetch(url)
  }
})
```

## 📖 示例

查看 [examples](./examples/) 目录获取更多使用示例：

- **[minimal-example.ts](./examples/minimal-example.ts)** - 最小化示例
- **[basic-user-crawl.ts](./examples/basic-user-crawl.ts)** - 基础用户爬取

## 🔧 开发

### 项目设置

```bash
# 克隆项目
git clone <repository-url>
cd weibo-sdk

# 安装依赖
pnpm install

# 构建所有包
pnpm run build

# 开发模式（监听文件变化）
pnpm run dev
```

### 运行示例

```bash
# 设置环境变量
export WEIBO_COOKIE="your-cookie-here"
export TARGET_USER_ID="1234567890"

# 运行示例
pnpm tsx examples/minimal-example.ts
pnpm tsx examples/basic-user-crawl.ts
```

### 测试

```bash
# 运行所有测试
pnpm test

# 运行特定包的测试
pnpm --filter @weibo-sdk/core test
```

## 📚 文档

- [核心框架文档](./packages/core/README.md)
- [插件开发指南](./packages/plugins/README.md)
- [微博API文档](./packages/weibo/README.md)
- [架构设计](./docs/从脚本工具到框架：构建一个现代、可扩展的插件化微博爬虫SDK设计.md)

## 🤝 贡献

欢迎贡献代码！请遵循以下步骤：

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

### 开发规范

- 使用 TypeScript 编写所有代码
- 遵循 ESLint 配置
- 为新功能添加测试
- 更新相关文档

## ⚠️ 免责声明

本SDK仅用于学习和研究目的。使用时请遵守：

- 微博平台的服务条款
- 相关法律法规
- 数据保护和隐私政策
- 合理的请求频率限制

请确保您的使用方式符合道德和法律要求。

## 🔗 相关项目

- [axios](https://github.com/axios/axios) - Promise based HTTP client
- [winston](https://github.com/winstonjs/winston) - A logger for just about everything
- [tsup](https://github.com/egoist/tsup) - The simplest and fastest way to bundle your TypeScript libraries

## 📄 许可证

[MIT License](./LICENSE.md)

---

**注意**: 这是一个开源项目，使用前请确保遵守相关法律法规和平台政策。
