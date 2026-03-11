# Weibo SDK

一个面向开发者的**微博 API 逆向 TypeScript SDK**：通过分层架构与契约，将微博接口返回的易变 raw JSON 稳定转换为领域模型，并提供可维护、可测试（默认离线）的服务能力（用户/微博等）。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-8.0+-orange.svg)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🌟 特性

- **分层架构**：`WeiboSDK -> Services -> Fetcher/Auth/RateLimit -> Raw/Domain Models`
- **类型安全**：完整的 TypeScript 类型，领域模型契约清晰
- **离线可测**：默认 `pnpm test` 不依赖真实微博网络 IO（E2E 需显式开启）
- **错误结构化**：自定义错误类型，便于诊断与重试决策
- **速率控制**：内置限速/并发控制，避免触发风控

## 🚀 快速开始

### 安装

```bash
# 安装所有依赖
pnpm install

# 构建所有包
pnpm run build
```

### 获取用户信息（示例）

```typescript
import { WeiboSDK } from 'weibo-sdk'

const sdk = new WeiboSDK({
  cookie: process.env.WEIBO_COOKIE || '',
})

const user = await sdk.users.getById('1111681197')
console.log(user.id, user.name, user.stats.followers)
```

### 获取用户微博列表（示例）

```typescript
import { WeiboSDK } from 'weibo-sdk'

const sdk = new WeiboSDK({
  cookie: process.env.WEIBO_COOKIE || '',
})

const page = await sdk.tweets.listByUserId('1111681197')
console.log(page.sinceId, page.tweets[0]?.id)
```

## 📚 文档

- 架构与契约规格：`docs/微博SDK技术规格书_v2.0.md`
- 开发计划与 TODO：`docs/渐进式开发计划.md`、`docs/TODO.md`
- 项目概览：`docs/项目概览.md`

## 🧪 测试

- 离线测试：`pnpm test`
- E2E（真实 Cookie + 外网，默认跳过）：设置 `WEIBO_E2E=1` 后运行 `pnpm test`

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
