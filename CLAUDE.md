# CLAUDE.md (Repo-wide)

本文件的约束适用于整个仓库下所有目录与文件，除非子目录存在更具体的 `AGENTS.md` / `CLAUDE.md` 覆盖。

## 项目目的 (Mission)

实现一个**可维护、易于理解、开发者体验优秀**的微博 API 逆向开源项目（SDK 形态），支持在不稳定的上游字段/API 变更下，依然能以**契约稳定**的方式向下游提供能力。

目标优先级：

1. **可维护性/可读性**：模块边界清晰、职责单一、命名一致、文档即事实。
2. **可测试性**：默认测试必须**离线可跑**（不依赖真实微博网络 IO），每个功能必须有对应测试用例。
3. **开发者体验**：类型完整、导出稳定、错误可诊断、用法清晰。
4. **可观测性**：遵循 Wide Events 思想，关键路径必须可追踪、可定位问题。

## 开发纪律（强制）

1. **文档先行（docs-first）**：每个任务第一步先更新相关文档（开发日志 `docs/development-log/`、任务状态、方案文档），再开始写代码；实施过程中随实际反馈同步修改文档，而非事后补记。完成阶段的规划文档移入 `docs/archive/`（历史记录，不主动读取）。
2. **先写 commit message 再写代码**：动工前用 Conventional Commit 格式确定提交信息，围绕该 message 的范围编码；diff >10 文件或 >200 行时必须拆分。模块创建、功能实现、配置修改、文档更新分开 commit。
3. **开写前先读 postmortem 高频雷区**（`docs/postmortem/README.md`）：对照「高频雷区」自查，避免重复踩坑。写码期间同步跑本地质量门禁（typecheck/lint），不要等 CI 才发现。

## 文档索引

文档中央索引见 `docs/README.md`。核心文档（本文件仅收录全局硬约束，详细说明见对应文档）：

| 文档 | 内容 |
|------|------|
| `docs/README.md` | 文档中央索引（按分类导航 + 约定） |
| `docs/微博SDK技术规格书_v2.0.md` | 分层架构与契约定义（与实现对齐） |
| `docs/requirements/glossary.md` | 意见性术语表（领域/协议/架构/可观测性） |
| `docs/planning/architecture.md` | 架构决策记录（ADR） |
| `docs/渐进式开发计划.md` | 开发路线图、测试策略、fixture 清单、真实数据获取操作手册 |
| `docs/CLI.md` | CLI 命令参考与架构说明 |
| `docs/error-diagnostics.md` | 错误排障手册（结构化错误码表、排查流程） |
| `docs/postmortem/README.md` | 尸检报告索引 + 高频雷区自查清单（写码前必读） |
| `docs/development-log/` | 按天开发日志 |
| `docs/archive/` | 已完成阶段归档（历史记录，不主动读取） |
| `docs/SKILL.md` | SDD（规格驱动开发）、Wide Events、Structured Error 等工程规范 |
| `docs/TODO.md` | 当前进度与待做清单（P0/P1/P2） |

## 架构约定

### 分层

```
WeiboSDK（门面）
  └─ UserService / TweetService / SearchService（领域服务）
       └─ FetcherService（HTTP 核心，所有 Service 继承它）
            ├─ AuthService（Cookie / XSRF）
            ├─ RateLimitService（令牌桶）
            └─ EndpointSpec + Zod（协议校验）
```

### Endpoint 定义规范（defineEndpoint）

新增微博 API endpoint 必须遵循以下步骤：

1. 在 `src/services/endpoints/<domain>.ts` 中定义 `argsSchema`、`responseSchema`、`buildResource`、`okPolicy`。
2. 使用 `defineEndpoint(spec)` 包装以获取完整类型推导。
3. 在 Service 中通过 `this.request(spec, args)` 调用。

**反模式**：禁止在 Service 文件中内联 Zod schema 和 EndpointSpec 定义。

### 领域模型归一化

- Raw 响应 → Domain Model 的转换逻辑放在 `src/models/data/<Model>.ts` 中，必须是纯函数。
- 提供默认值、fallback 链、开放端点保留未知字段处理。

## 代码风格

- TypeScript `strict` 模式；尽量避免 `any`（无法避免时在边界层集中，并加测试保护）。
- 公共 API：先写类型/接口契约（Contract First），再实现。
- 核心逻辑尽量纯函数；IO 通过依赖注入或可替换适配器隔离。
- 禁止在库入口产生副作用（例如 `console.log`）；日志/调试必须走 Wide Events 通道。

## 测试策略

- **每个功能都必须有对应测试用例**。
- 默认 `pnpm test` 必须离线稳定：unit（纯函数/0 IO）、component（mock HTTP/clock/sleep）、E2E（`WEIBO_E2E=1` 显式开启）。
- **E2E 门控**：`tests/e2e/**` 用例仅在 `WEIBO_E2E === '1'` **且** `WEIBO_COOKIE` 存在时运行（`describe.skip` 默认跳过）；`WEIBO_E2E` 由 `vitest.e2e.config.ts` 显式设置，**不放入 `.env`**（避免默认 `pnpm test` 误跑）。真实 Cookie 仅存于 `.env` / 环境变量。
- 新增测试前先写失败用例（Red → Green → Refactor）。
- 详见 `docs/渐进式开发计划.md` 测试策略章节。

## 错误与诊断

- 禁止直接 `throw new Error('...')`；必须使用结构化错误（继承 `WeiboSDKError`），携带 `code/level/retryable/context`。
- 所有错误路径必须有测试覆盖。
- 错误映射链：axios error → TransportError；ok !== 1 → BusinessError；Zod fail → ProtocolError。
- 详见 `docs/error-diagnostics.md`。

## 可观测性 (Wide Events)

- 关键路径必须发出"宽事件"（扁平键值对，包含 `event_name/timestamp/trace_id`）。
- Happy Path 与 Error Path 都需要事件覆盖，测试中可断言事件序列与字段完整性。
- 使用 `TelemetryCollector` 模式（测试中 `events: TelemetryEvent[]` 收集并断言）。
- Telemetry 的 emit 失败绝不能影响 SDK 正常功能（`telemetry?.emit()` 调用外包裹 try/catch）。
- 详见 `docs/SKILL.md`。

## Git / 变更管理

- 开发分支前缀必须是 `claude/`。
- 每次变更需能通过 `git diff` 清晰审阅；不做无关重构；优先小步快跑。
- **先写 commit message 再写代码**，diff >10 文件或 >200 行时主动拆分（见「开发纪律」）。

## 分支 / PR / 合并

- **分支生命周期**：单个 `claude/*` 分支只承载一个清晰主题，尽快合并回 `main`。
- **PR 粒度**：优先拆成多个 PR，每个 PR 可独立 review / 可独立回滚 / 不依赖未合并分支。
- **PR 正文格式**：禁止在命令行里用字面量 `\n` 拼 body。优先使用 `gh pr create/edit --body-file <file>`。
- **提交规范**：建议 Conventional Commits（`feat:`, `fix:`, `docs:`, `test:`, `refactor:`）。
- **先定提交意图**：开始编码前先写清楚 PR 主题与提交信息。范围变化时先更新提交计划再继续。
- **合并门禁**（必须全部满足）：
  - [ ] `pnpm test` 通过（默认离线）
  - [ ] `pnpm run typecheck` 通过
  - [ ] 文档与代码一致
  - [ ] 新增功能有对应测试
- **E2E 策略**：需要真实 Cookie/外网的用例必须默认跳过，仅在 PR/发布前由维护者显式开启。
- **合并策略**：优先 Squash merge；合并后及时删除分支。

## 数据驱动开发

**核心原则：所有代码的正确性必须以真实微博 API 返回数据为准。**

这是逆向工程 SDK，微博上游 API 没有文档、没有版本承诺。手写的 TypeScript 接口和 Zod schema 只是"猜"，只有真实 API 响应能证明正确性。

### 约束

1. **新增/修改任何 Zod schema 前**，必须先获取对应的真实 API 响应并存为 fixture（`tests/fixtures/raw/`）。
2. **新增/修改任何 Model 归一化逻辑前**，必须用至少 2 种不同变种的真实 fixture 验证。
3. **字段类型声明**必须以真实 API 返回的实际类型为准，而非直觉（例如 `since_id` 实际是 `string` 而非 `number`）。
4. **不得仅凭手写的 Raw 接口来推导 Schema**——应先看真实数据再写 Schema。

获取真实数据的操作手册见 `docs/渐进式开发计划.md`。

## CLI Interface Mandate

每个 SDK 功能必须通过 CLI 暴露，确保可观测性和可测试性。

### 约束

1. 新增公开 Service 方法时，必须在 CLI 中添加对应子命令。
2. Cookie 优先从 `WEIBO_COOKIE` 环境变量或 `.env` 文件读取；`--cookie`/`-c` 为可选覆盖。
3. 所有命令输出必须为 JSON 格式（`JSON.stringify(data, null, 2)`），确保下游可管道处理。
4. 错误必须输出到 stderr 并以非零退出码退出。

基于 [citty](https://github.com/unjs/citty)。详细命令参考见 `docs/CLI.md`。

## 自动化执行边界

- 满足合并门禁的前提下，可自行创建 PR、更新 PR 文案、rebase、squash merge、删除分支。
- 若 PR 涉及较大重构、可能引入 breaking change、或需要真实外网验证（E2E），必须先在 PR 中明确风险点并等待确认后再合并。

## Postmortem 约定

- Postmortem 放在 `docs/postmortem/` 目录下，命名格式 `NNN-short-slug.md`，按 `docs/postmortem/TEMPLATE.md` 模板撰写。
- 每次重要迭代/事故修复/关键特性发布后新增一条（不要覆盖旧记录），并在 `docs/postmortem/README.md` 索引表登记。
- 目标：根因分析（blameless）、知识固化、防止同类问题复发；**写码前先读「高频雷区」自查**。
- 流程级根因同步更新本文件强制规范或相关工程文档。
