# 代码规范

**项目**: weibo-sdk | **最后更新**: 2026-08-09

> 本文档对齐 Float / chill-s3 的 Code Style 规范，适配 weibo-sdk（TypeScript 库 + pnpm + Vitest + @antfu/eslint-config）。

## TypeScript 风格

### 命名约定

| 类型 | 风格 | 示例 |
|---|---|---|
| 类 / 类型 / 接口 | PascalCase | `WeiboSDK`、`TweetService`、`IRequestResource` |
| 函数 / 方法 | camelCase | `normalizeTweet()`、`listByUserId()` |
| 常量 | UPPER_SNAKE_CASE | `VERSION`、`MediaType` 枚举成员 |
| 变量 / 参数 | camelCase | `traceId`、`sinceId` |
| 泛型参数 | 单个大写字母（有约束） | `T extends ...` |
| 包 / 目录 | 全小写 + 连字符 | `src/models/data/`、`src/services/endpoints/` |
| 文件 | 同名于导出（PascalCase 类） | `WeiboSDK.ts`、`FetcherService.ts` |
| 测试文件 | `*.test.ts` | `Tweet.test.ts` |

### 文件组织

```ts
// 1. import：外部依赖 → 路径别名（~/）→ 相对路径
import type { AxiosInstance } from 'axios'
import type { IResource, IResourceType } from '~/types/resources'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { AuthService } from './AuthService'

// 2. 类型 / 常量
// 3. 类 / 函数定义
// 4. private helpers（放文件底部或就近）
```

### 公共 API

- **契约优先（Contract First）**：先写类型/接口契约，再实现
- **类型推导优先**：响应类型用 `z.infer<typeof Schema>` 推导，消费者使用导出的命名类型（见规格书 §3.7）
- **禁止从包入口导出内部实现**：`services/*`、`models/data` 内部 helper 等
- 新增公开 Service 方法时必须加对应 CLI 子命令（CLI Mandate）

### 禁止事项

| 禁止 | 替代方案 |
|---|---|
| `any`（含隐式） | 明确类型 / `unknown` + 收窄；边界层集中使用 + 测试保护 |
| 直接 `throw new Error('...')` | 继承 `WeiboSDKError` 的结构化错误（code/level/retryable/context） |
| 在 Service 内联 Zod schema / EndpointSpec | 定义在 `src/services/endpoints/**`，用 `defineEndpoint()` |
| 库入口产生副作用（`console.log`） | 日志走 Wide Events 通道 |
| 手写响应类型替代 schema | `z.infer`（schema 是单一事实源） |
| 猜测 API URL / 字段类型 | 先抓包存 fixture（数据驱动，ADR-002） |
| wildcard import | 显式 import |

## 分层约束

```
WeiboSDK（门面）
  └─ UserService / TweetService / ...（领域服务，继承 FetcherService）
       └─ FetcherService（HTTP 核心：preflight → rate limit → 请求 → okPolicy → safeParse → hooks）
            ├─ AuthService / RateLimitService
            └─ EndpointSpec + Zod（协议校验）
```

- Service 文件只负责「装配 args + 调 `this.request(spec, args)`」，不内联 schema
- Raw → Domain 的归一化放 `src/models/data/<Model>.ts`，必须是**纯函数**
- 核心逻辑尽量纯函数；IO 通过依赖注入 / 可替换适配器隔离（FetcherService 注入 axios、RateLimitService 注入 clock）
- 构造函数注入依赖用 deps 参数（`deps?: ConstructorParameters<typeof FetcherService>[1]`）

## 测试规范

对标「测试先行 + 每个功能必有测试」：

### 分层

| 类型 | 网络 | 数据 | 运行条件 |
|---|---|---|---|
| Unit | 无 | 硬编码 | `pnpm test` |
| Component | 无（fakeAxios / FakeClock） | mock | `pnpm test` |
| Fixture-based | 无 | 真实脱敏 fixture | `pnpm test` |
| E2E | 真实 | 真实 Cookie | `WEIBO_E2E=1`（显式开启） |

### 命名

`methodName_condition_expectedResult()`

```ts
describe('normalizeTweet', () => {
  it('retweetedNull_returnsUndefinedRetweetedStatus', () => { /* ... */ })
})
```

### 结构

Given-When-Then：

```ts
it('listByUserId_emptySinceId_hasMoreFalse', () => {
  // Given
  const sdk = createSDK({ client: fakeAxios({ list: [], since_id: '', total: 0 }) })
  // When
  const result = await sdk.tweets.listByUserId('123')
  // Then
  expect(result.hasMore).toBe(false)
})
```

### 规则

- **Red → Green → Refactor**：新增测试先写失败用例
- **Fakes over Mocks**：测试基座收敛到 `tests/testkit/`（`fakeAxios` / `FakeClock` / `TelemetryCollector`），别复制粘贴
- **测试必须 fail loudly**：禁止用 `try/catch` 跳过失败的 E2E / 未知端点
- **结构断言**：脱敏后的 fixture 数据做 `typeof`/结构断言，不做精确值比较（ADR-010）
- 断言 Wide Events 序列与字段完整性（`TelemetryCollector`）
- 覆盖边界：分页（空 since_id / total -1）、null vs undefined、媒体变种（video/geo/livephoto/gif）

### 门禁

```bash
pnpm test            # 默认离线
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # eslint --fix
```

## Lint / 类型检查

```bash
pnpm run lint          # ESLint（@antfu/eslint-config）
pnpm run typecheck     # TypeScript strict
```

- 禁止 `--no-verify` 跳过 simple-git-hooks
- 无 `TODO()` 遗留（用 `FIXME` + 建 Issue）
- 开写前读 [postmortem README](../postmortem/README.md)「高频雷区」自查（数据驱动 / 错误与可观测性 / 工程卫生 / 流程）
