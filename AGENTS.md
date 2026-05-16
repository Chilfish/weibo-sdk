# AGENTS.md (Repo-wide)

本文件的约束适用于整个仓库下所有目录与文件，除非子目录存在更具体的 `AGENTS.md` 覆盖。

## 项目目的 (Mission)

实现一个**可维护、易于理解、开发者体验优秀**的微博 API 逆向开源项目（SDK 形态），支持在不稳定的上游字段/API 变更下，依然能以**契约稳定**的方式向下游提供能力。

目标优先级：

1. **可维护性/可读性**：模块边界清晰、职责单一、命名一致、文档即事实。
2. **可测试性**：默认测试必须**离线可跑**（不依赖真实微博网络 IO），每个功能必须有对应测试用例。
3. **开发者体验**：类型完整、导出稳定、错误可诊断、用法清晰（参考知名前端 TypeScript 开源项目的工程实践）。
4. **可观测性**：遵循 Wide Events 思想（见 `docs/SKILL.md`），关键路径必须可追踪、可定位问题。

## 规范来源 (MUST Follow)

- 必须遵循：`docs/SKILL.md` 中的 SDD（规格驱动开发）、Wide Events、Structured Error 等约束。
- 必须遵循：`docs/微博SDK技术规格书_v2.0.md` 的分层架构与契约定义（实现可以渐进，但不得背离目标）。
- 必须遵循：`docs/渐进式开发计划.md` 的"每一步可用 + 测试驱动"原则。

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

1. 在 `src/services/endpoints/<domain>.ts` 中定义：
   - `argsSchema`：Zod schema（如 `z.object({ uid: z.string() })`）
   - `responseSchema`：Zod schema（`.loose()` 为默认 strictness）
   - `buildResource`：将 args 转为 `IRequestResource`
   - `okPolicy`：`{ mode: 'none' }` 或 `{ mode: 'require_ok_1' }`
2. 使用 `defineEndpoint(spec)` 包装以获取完整类型推导。
3. 在 Service 中通过 `this.request(spec, args)` 调用（切勿绕过 EndpointSpec 直接 `this.fetch()`）。

**反模式**：禁止在 Service 文件中内联 Zod schema 和 EndpointSpec 定义。

### 领域模型归一化

- Raw 响应 → Domain Model 的转换逻辑放在 `src/models/data/<Model>.ts` 中。
- 归一化必须是纯函数（可由构造器包装，但核心逻辑不依赖 IO）。
- 提供默认值、fallback 链、开放端点保留未知字段处理。

## 开发风格与工程标准

### 代码风格

- TypeScript `strict` 模式；尽量避免 `any`（确实无法避免时要在边界层集中、并加测试保护）。
- 公共 API：先写类型/接口契约（Contract First），再实现。
- 核心逻辑尽量纯函数；IO（网络/文件/时间/睡眠）通过依赖注入或可替换适配器隔离。
- 禁止在库入口产生副作用（例如 `console.log`）；日志/调试必须走可观测性通道（Wide Events）。

### 测试策略 (TDD)

- **每个功能都必须有对应测试用例**（新增代码必须带测试）。
- 默认 `pnpm test` 跑的测试必须离线稳定：
  - 单元测试：纯函数/模型/类型映射，0 IO。
  - 组件测试：通过 mock（HTTP/clock/sleep）覆盖 Fetcher/Auth/RateLimit 等边界组件。
  - E2E/集成测试：允许真实 Cookie + 真实网络，但必须默认跳过（通过 `WEIBO_E2E=1` 环境变量显式开启）。
- 新增测试前先写失败用例，再实现（Red → Green → Refactor）。
- 测试工具：`tests/testkit/fakeAxios.ts` 提供 `createFakeAxios(handler)` + `NoopRateLimitService`；测试中可定义 `FakeClock` 实现 `IRateLimitClock` 接口。

### 错误与诊断

- 禁止直接 `throw new Error('...')` 作为业务/协议错误；必须使用结构化错误（继承 `WeiboSDKError`），携带 `code/level/retryable/context`。
- 所有错误路径必须有测试覆盖（至少覆盖映射/重试属性/上下文）。
- 错误映射链：axios error → TransportError；ok !== 1 → BusinessError；Zod fail → ProtocolError。

### 可观测性 (Wide Events)

- 关键路径必须发出"宽事件"（扁平键值对，包含 `event_name/timestamp/trace_id` 及关键上下文）。
- Happy Path 与 Error Path 都需要事件覆盖，且测试中可断言事件序列与字段完整性。
- 使用 `TelemetryCollector` 模式（在测试中 `events: TelemetryEvent[]` 收集并断言）。
- Telemetry 的 emit 失败绝不能影响 SDK 正常功能（所有 `telemetry?.emit()` 调用外包裹 try/catch）。

## Git / 变更管理

- 开发分支前缀必须是 `claude/`。
- 每次变更需要能通过 `git diff` 清晰审阅；不做无关重构；优先小步快跑。

## 现代化开源协作流程（分支 / PR / 合并）

本仓库采用"短分支 + PR"为核心的协作方式：

- **分支生命周期**：单个 `claude/*` 分支只承载一个清晰主题，目标是尽快合并回 `main`（避免长时间堆积）。
- **PR 粒度**：优先拆成多个 PR，每个 PR 可独立 review / 可独立回滚 / 不依赖未合并分支。
- **PR 正文格式**：禁止在命令行里用字面量 `\n` 拼 body（会导致正文显示为转义字符）。优先使用 `gh pr create/edit --body-file <file>` 或 here-string 写入临时文件再提交。
- **提交规范**：提交信息要可读、可追溯（建议 Conventional Commits：`feat:`, `fix:`, `docs:`, `test:`, `refactor:`）。
- **先定提交意图**：开始编码前，先写清楚本分支的 PR 主题、预期行为变化与提交信息（commit message）。尽量不要"看 diff 才临时想 message"。若实现过程中范围发生变化，先更新提交计划再继续。
- **合并门禁**：PR 合并前必须满足：
  - [ ] `pnpm test` 通过（默认离线）
  - [ ] `pnpm run typecheck` 通过
  - [ ] 文档与代码一致（"文档即事实"）
  - [ ] 新增功能有对应测试（TDD）
- **E2E 策略**：需要真实 Cookie/外网的用例必须默认跳过，仅在 PR/发布前由维护者显式开启验证。
- **合并策略**：优先 Squash merge（保持 `main` 历史干净），必要时 Rebase；合并后及时删除分支。

## 数据驱动开发（Data-Driven Development）

**核心原则：所有代码的正确性必须以真实微博 API 返回数据为准。**

### 为什么

这是一个逆向工程 SDK，微博的上游 API 没有文档、没有版本承诺、字段随时可能漂移。
手写的 TypeScript 接口和 Zod schema 本质上只是"猜"，只有真实 API 响应能证明正确性。

### 约束

1. **新增/修改任何 Zod schema 前**，必须先获取对应的真实 API 响应并存为 fixture（`tests/fixtures/raw/`）。
2. **新增/修改任何 Model 归一化逻辑前**，必须用至少 2 种不同变种的真实 fixture 验证。
3. **字段类型声明**必须以真实 API 返回的实际类型为准，而非直觉（例如 `since_id` 实际是 `string` 而非 `number`）。
4. **不得仅凭手写的 Raw 接口来推导 Schema**——应先看真实数据再写 Schema。

### 如何获取真实数据

`.env` 文件中的 `WEIBO_COOKIE` 包含有效的登录凭证。

在需要获取特定微博数据时，按以下步骤操作：

1. **确定用户 UID 或微博 mblogid**
   - 用户 UID 可以从用户主页 URL 获取（`weibo.com/u/{uid}`）
   - 微博 mblogid 可以从时间线返回的 `list[].mblogid` 获取

2. **使用 curl 配合 Cookie 调用 API**
   ```bash
   source .env
   curl -s -H "Cookie: $WEIBO_COOKIE" \
     -H "X-XSRF-TOKEN: $(echo $WEIBO_COOKIE | sed -n 's/.*XSRF-TOKEN=\([^;]*\).*/\1/p')" \
     -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
     "https://weibo.com/ajax/statuses/show?id={mblogid}&isGetLongText=true"
   ```

3. **保存为 fixture**：保存到 `tests/fixtures/raw/{描述性名称}.json`

4. **校验当前 Schema**：用真实数据运行 Zod schema 校验，发现不匹配立即修正

### 真实数据与当前代码的已知差异

见 `docs/渐进式开发计划.md` 中"Phase 1：基于真实数据的 Bug 修复"。

## 自动化执行边界（我可以自行完成的事）

- 我可以在满足"合并门禁"的前提下，**自行创建 PR、更新 PR 文案、rebase、squash merge、删除分支**。
- 若 PR 涉及较大重构、可能引入 breaking change、或需要真实外网验证（E2E），必须先在 PR 中明确风险点并等待确认后再合并。

## Postmortem 约定（知识固化 / 上下文注入）

在现代软件工程中，Postmortem（追思/事后分析）源自医学术语，指在项目阶段结束、重大事故（Incidents）处理完毕或关键特性发布后，对过程进行的结构化回顾与深度解剖。其核心目标不是追责，而是通过根因分析（Root Cause Analysis, RCA），提取技术负债、逻辑误区或架构缺陷的确定性结论，防止同类问题再次发生。

- Postmortem 统一放在仓库根目录的 `postmortem/` 目录下。
- 文件命名必须为：`NNN-short-slug.md`（例如 `001-offline-test-baseline.md`）。
- 每次重要迭代/事故修复/关键特性发布后，应新增一条 Postmortem（不要覆盖旧记录）。
