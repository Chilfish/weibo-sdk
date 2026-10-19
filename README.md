# Weibo SDK

一个面向开发者的**微博 API 逆向 TypeScript SDK**：通过分层架构与契约，将微博接口返回的易变 raw JSON 稳定转换为领域模型，并提供可维护、可测试（默认离线）的服务能力（用户/微博等）。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.0+-orange.svg)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 特性

- **分层架构**：`WeiboSDK → Services → Fetcher/Auth/RateLimit → Raw/Domain Models`
- **类型安全**：完整的 TypeScript 类型，EndpointSpec + Zod 校验，领域模型契约清晰
- **离线可测**：默认 `pnpm test` 不依赖真实微博网络 IO（E2E 需显式开启）
- **错误结构化**：自定义错误层次（Transport/Protocol/Business），便于诊断与重试决策
- **Wide Events 可观测**：内置扁平化遥测事件（`request_start/success/error` 等），支持 trace_id 全链路追踪
- **会话自检**：`selfCheck()` 支持 lazy/eager/none 三种模式，Cookie 过期提前诊断
- **速率控制**：令牌桶算法，支持并发控制，避免触发风控

## 版本与契约

- **包版本 0.x**：实现可随微博上游漂移修复（patch/minor），不承诺实现细节稳定。
- **`ITweet` 存档契约自 v1 冻结**：字段只增不改；rename / remove / 类型变更才升 v2 并随包 major 发布。
- 契约版本与包版本解耦，规则见 [`docs/engineering/contract-itweet-v1.md`](./docs/engineering/contract-itweet-v1.md)。

## 快速开始

### 安装与构建

```bash
pnpm install
pnpm run build
```

### 获取用户信息

```typescript
import { WeiboSDK } from 'weibo-sdk'

const sdk = new WeiboSDK({
  cookie: process.env.WEIBO_COOKIE || '',
})

const user = await sdk.users.getById('1111681197')
console.log(user.id, user.name, user.stats.followers)
```

### 获取用户微博列表

```typescript
const page = await sdk.tweets.listByUserId('1111681197')
console.log(page.page, page.hasMore, page.tweets[0]?.id)
```

### 获取单条微博详情

```typescript
const tweet = await sdk.tweets.getByMblogId('QqsYymYOS')
console.log(tweet.text, tweet.media)
```

### CLI

CLI 的 Cookie **只从 `.env` 读取**（默认 `<pwd>/.env`，可用 `--env-file` 指定），不读取环境变量；`--cookie`/`-c` 为显式覆盖。

```bash
pnpm build
node dist/cli.mjs whoami
```

## 文档

文档中央索引见 `docs/README.md`。核心文档：

- 架构与契约规格：`docs/engineering/technical-spec.md`
- 开发计划与路线图：`docs/planning/roadmap.md`
- 术语表：`docs/requirements/glossary.md`
- 架构决策（ADR）：`docs/planning/architecture.md`
- CLI 命令参考：`docs/engineering/cli.md`
- 错误排障手册：`docs/engineering/error-diagnostics.md`

## 测试

- 离线测试（默认）：`pnpm test`
- E2E（真实 Cookie + 外网，默认跳过）：在项目根目录 `.env` 配置 `WEIBO_COOKIE` 后运行 `pnpm test:e2e`（不读取环境变量）

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm run build

# 开发模式（stub 模式，实时更新）
pnpm run dev

# 类型检查
pnpm run typecheck

# Lint
pnpm run lint
```

## 贡献

欢迎贡献代码！请遵循以下步骤：

1. Fork 项目
2. 创建功能分支（`git checkout -b claude/amazing-feature`）
3. 提交更改（建议 Conventional Commits）
4. 推送到分支并创建 Pull Request

开发规范详见 `CLAUDE.md`。

## 免责声明

本 SDK 仅用于学习和研究目的。使用时请遵守：

- 微博平台的服务条款
- 相关法律法规
- 数据保护和隐私政策
- 合理的请求频率限制

## 许可证

[MIT License](./LICENSE.md)
