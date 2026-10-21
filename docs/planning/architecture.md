# 架构决策记录（ADR）

> 记录关键架构决策及其理由。格式：编号 / 日期 / 状态 / 决策 / 背景 / 理由 / 后果。
> 判断是否值得记 ADR：**难以逆转** + **离开上下文会让人疑惑** + **是真实取舍的结果**。三者缺一不记。
> 新决策追加编号；被推翻的决策标 `SUPERSEDED by ADR-NNN` 或 `NOT ADOPTED`，不删除历史。

---

## ADR-001: 四层分离架构

- **日期**: 2026-02-03 / 对齐 2026-05-16
- **状态**: accepted
- **决策**: `WeiboSDK（门面）→ 服务层（按领域）→ 基础设施层（Fetcher/Auth/RateLimit）→ 数据层（raw/domain + models）`，外加统一错误层。
- **背景**: 微博 API 无文档、字段易变，需要一个把 raw JSON 稳定转换为领域契约的边界。
- **理由**: 门面聚合 6 个 Service；Service 继承 `FetcherService` 复用请求管线；数据层用纯函数归一化，让「易变的 raw」与「稳定的 domain」解耦。
- **后果**: 新增能力 = 新增 endpoint spec + service 方法 + CLI 子命令，路径可预测。

## ADR-002: 数据驱动开发（真实 API 优先）

- **日期**: 2026-05-16
- **状态**: accepted
- **决策**: 所有 Zod schema / 归一化逻辑必须以真实微博 API 响应（`tests/fixtures/raw/`）为准，禁止凭手写接口推导；新增/修改 schema 前必须先抓包存 fixture。
- **背景**: 5 个生产 bug 全部源于"合理推断"而非"数据验证"——`since_id` 实际是 `string`、`total` 可为 `-1`、`retweeted_status.user` 可为 `null`。
- **理由**: 这是逆向 SDK，上游无版本承诺。手写类型只是猜测，真实响应才是真相。
- **后果**: 强制流程成本（先抓包再实现），换来 schema 与真实的契约一致性。写入 `AGENTS.md` 成为硬约束。

## ADR-003: EndpointSpec + Zod 集中校验

- **日期**: 2026-05-16
- **状态**: accepted
- **决策**: 端点定义统一为 `EndpointSpec`（`resourceType` + `endpoint` + `argsSchema` + `buildResource` + `okPolicy` + `schema`），用 `defineEndpoint()` 包装；禁止在 Service 内联 Zod/EndpointSpec。
- **背景**: 早期 schema 散落在 service 文件中，难以统一校验、复用与审阅。
- **理由**: args 类型从 `argsSchema` 自动推导；`request(spec, args)` 统一走 preflight → 请求 → okPolicy → safeParse → hooks/telemetry 全流程。
- **后果**: 端点定义有唯一范式，反模式（内联 schema）被 `AGENTS.md` 明确禁止。

## ADR-004: 结构化错误体系

- **日期**: 2026-02-03 / 完善 2026-05-16
- **状态**: accepted
- **决策**: 统一继承 `WeiboSDKError`（`code` / `level` / `retryable` / `context`），禁止直接 `throw new Error('...')`；映射链：axios → TransportError（`NET_TIMEOUT` / `NET_REQUEST_FAILED`）、ok≠1 → BusinessError（`API_NOT_OK` / `AUTH_SESSION_EXPIRED`）、Zod fail → ProtocolError（`API_BAD_RESPONSE`）。
- **背景**: 早期 `validateConfig` 抛裸 `Error`，错误不可区分、不可重试判断；`instanceof` 因原型链问题失效。
- **理由**: 结构化错误是 SDK 的 API 一部分，`level` + `retryable` 让下游能做重试决策。
- **后果**: 所有错误路径必须有测试覆盖；新增错误类走同一基类。

## ADR-005: Wide Events（Telemetry）

- **日期**: 2026-05-16
- **状态**: accepted
- **决策**: 以 `WeiboSDKTelemetry.emit(event)` 输出扁平 KV 宽事件（必含 `event_name/timestamp/trace_id`，其余 primitive），事件集：`sdk_init` / `self_check_*` / `request_start|success|error` / `rate_limit_wait` / `normalize_done`。
- **背景**: `onFetched` 只覆盖成功路径且无标准事件结构，难以断言与索引。
- **理由**: Wide Events 是「生产可观测性 + 测试可断言」的统一通道；`emit` 失败 MUST NOT 影响 SDK 功能（try/catch 包裹）。
- **后果**: `FetcherService.onFetched` 标 `@deprecated`；测试可用 `TelemetryCollector` 断言事件序列与字段完整性。

## ADR-006: 离线测试分层

- **日期**: 2026-02-03 / 确定 2026-05-16
- **状态**: accepted
- **决策**: 默认 `pnpm test` 必须离线稳定。分层：Unit（纯函数/0 IO）→ Component（fakeAxios/FakeClock mock HTTP/时间）→ Fixture-based（真实脱敏数据）→ E2E（`WEIBO_E2E=1` 显式开启）。
- **背景**: 早期「集成测试」是顶层 await 脚本 + 真外网请求，默认测试 flaky 且不可离线。
- **理由**: 可测试性 = 反馈速度 = 迭代安全。IO 通过依赖注入隔离（`FetcherService` 注入 axios，`RateLimitService` 注入 clock）。
- **后果**: 新增功能先写失败用例（Red → Green → Refactor）；测试基座收敛到 `tests/testkit/`。

## ADR-007: 会话自检（selfCheck lazy/eager）

- **日期**: 2026-03-11
- **状态**: accepted
- **决策**: `WeiboSDK` 构造后按 `selfCheck.mode`（`none`/`lazy`/`eager`）执行会话自检，通过不带 uid 的 `ajax/profile/detail`（`myDetails()`）判断 Cookie 有效性；失败映射为 `AUTH_SESSION_EXPIRED`。
- **背景**: Cookie 过期时调用方看到「Cannot read properties of undefined」而非可诊断错误。
- **理由**: 提前诊断 + 结构化错误，让"预期内失败"可控；eager 模式失败不会产生未处理 Promise（`catch(() => {})` + 后续请求前重抛）。
- **后果**: `myDetailsSpec` 复用 `USER_DETAILS` 资源但空 args + 会话过期错误映射；`checkSession()` 提供非抛错版本。

## ADR-008: 构建工具 tsdown（弃 unbuild）

- **日期**: 2026-05-16
- **状态**: accepted
- **决策**: 从 unbuild 迁移到 tsdown（Rolldown，unjs 生态）。
- **背景**: unbuild 生态较小；tsdown 构建 908ms、自动 `.d.mts` 生成、自动管理 `exports`。
- **理由**: 与 citty 同作者生态一致；Rust 底层构建快；`exports: true` 自动管理包导出，移除 `main`/`module` 冗余。
- **后果**: `dist/index.mjs` 46.7KB；breaking：移除 `main`/`module`（`exports` 已足够），需更新导出回归测试。

## ADR-009: CLI 框架 citty + CLI Interface Mandate

- **日期**: 2026-05-16
- **状态**: accepted
- **决策**: 选 citty（unjs 生态、零依赖、函数式 `defineCommand`）实现 CLI；确立「每个 SDK 功能必须通过 CLI 暴露」的强制规范。
- **背景**: 对比 cac（类型推导浅）、clipanion（装饰器 + RC），citty 匹配项目风格。
- **理由**: 可观测性 + 可测试性：所有服务能力可用 CLI 验证，无需写测试代码；JSON 输出可管道处理。
- **后果**: 新增公开 Service 方法时必须加 CLI 子命令；Cookie 只从 `.env` 读取（默认 `<pwd>/.env`，`--env-file` 可指定），`--cookie` 显式覆盖，不读取环境变量；错误输出 stderr + 非零退出码。

## ADR-010: Fixture 脱敏策略（类型感知占位符）

- **日期**: 2026-05-16
- **状态**: accepted
- **决策**: fixture 脱敏采用类型感知替换：URL → `<URL>`、长数字 ID → `<ID>`、日期 → `<DATE>`、长文本 → `<TEXT>`；**≤40 字符短字符串保留**；number/boolean 保留。
- **背景**: 全量替换为 `<TEXT>` 破坏数据关联（`pic_ids` ↔ `pic_infos` 键匹配），导致 media 解析失败。
- **理由**: 保留值类型与短 ID 关联，才能在安全前提下维持 fixture 的数据结构与可测性。
- **后果**: 测试断言从精确值改为结构性断言（`typeof` 检查）；脱敏规则固化为 `tests/fixtures/raw/INDEX.md` 的约定。

## ADR-011: 结构快照替代值快照

- **日期**: 2026-05-16
- **状态**: accepted
- **决策**: E2E 快照用 `stripVolatileKeys()` 把可变值替换为类型占位符，只验证响应结构（key 路径 + 值类型），不验证具体值。实现为通用归一化：对象保留全部 key、数组只保留首元素、原始值统一为 `<STR>` / `<NUM>` / `<BOOL>` / `null`（2026-10-19 从 key 白名单改为通用规则）。
- **背景**: 微博 API 的计数器、签名 URL、ID 每次请求都不同，值快照 = flaky test；旧白名单不完整，动态字段仍会误报。
- **理由**: 快照应作为「Schema 漂移检测器」，而非数据正确性断言；字段增删/类型变化必须触发、单纯值变化必须不触发。
- **后果**: `tests/e2e/__snapshots__/` 结构快照覆盖全部核心 endpoint；E2E 失败 = 结构变更信号，需人工确认。E2E 与 `ArchiveService.schemaDigest` 统一复用 `src/utils/structure.ts`。

## ADR-012: 文档即事实（docs-as-truth）+ 文档体系

- **日期**: 2026-08-09
- **状态**: accepted
- **决策**: 文档与代码不一致时以代码为准并修正文档；docs 采用中央索引 + 按类分组（requirements/planning/engineering/postmortem/development-log/archive）的体系；文档先行（docs-first）为开发纪律。
- **背景**: 早期 README/规格书与代码大面积脱节（monorepo 假象、SearchService 占位误述、ErrorService 不存在），误导 contributor 与 Agent。
- **理由**: 对齐 Float 项目沉淀的文档纪律——先更新文档再写码、完成阶段归档、开发日志按天、postmortem 高频雷区写码前自查，降低上下文漂移。
- **后果**: 陈旧文档被修正；新增 `docs/README.md` 索引、`docs/requirements/glossary.md` 术语表、`docs/planning/architecture.md`（本文）、`docs/postmortem/` 规范化、`docs/development-log/` 按天日志、`docs/archive/` 归档机制。

## ADR-013: 媒体下载辅助（单条微博）

- **日期**: 2026-10-20
- **状态**: accepted
- **决策**: 归档流仍不自动下载媒体；新增显式调用的 `sdk.media.downloadTweetMedia` / `downloadByMblogId` 与 `weibo-cli media download <mblogId>`。CDN 请求只带微博域名 Referer，不携带 Cookie；主机后缀白名单；临时文件 + 原子 rename；403/404/410 单飞刷新一次。
- **背景**: 媒体 URL 约 1 小时过期，下游归档需要及时落盘；P0-2 原裁定「SDK 不下载」导致每个消费方重复实现防盗链、重试与失败记录。
- **理由**: 把「临时 URL」与「可选下载辅助」拆开：不改变 `ITweet`/`ArchiveItem` 契约，也不把下载耦合进归档流；下载器只处理单条微博，范围可控。
- **后果**: 下游可直接下载或继续自抓；`ArchiveItem` 仍无 `mediaFiles`；下载器为 Node-only，浏览器入口保持可加载。

## ADR-014: 三层扩展架构（Ports / Core / Plugins）

- **日期**: 2026-10-21
- **状态**: accepted（实施中，见 [todo-plugin-architecture.md](./todo-plugin-architecture.md)）
- **决策**: 把扩展面拆成三层：
  1. **Ports**：`WeiboTransport`（axios / fetch / 自定义）、`CredentialResolver`、`Clock`、telemetry / logger sink，构造注入。
  2. **Core 状态机**：端点鉴权要求、retry、rate-limit、auth-refresh、okPolicy、Zod 校验，保持不可插件化。
  3. **Plugins**：`beforeRequest` / `afterResponse` / `beforeRetry` / `onError` 生命周期钩子、`transport` 中间件、只读 `observe` 事件流；按 `pre → normal → post` 排序，构造期组装。
- **背景**: `FetcherService` 直接依赖 axios，换 fetch / Worker / Edge 需要改核心；日志与遥测分散；下游希望「开箱即用」又希望有可组合的扩展点。
- **理由**:
  - 环境适配（fetch / Worker / 测试替身）与行为扩展（缓存 / mock / 日志）是两类问题，混在一个插件数组里会让基础能力依赖插件顺序。
  - retry / rate-limit / auth-refresh 的先后顺序是正确性的一部分，不能交给用户配置。
  - 观察者失败必须隔离，生命周期钩子失败应当 fatal；两者语义不同，不能合并。
  - 无插件时走 identity 快路径，避免热路径分配。
- **后果**:
  - 新增 `transport` / `plugins` 配置，全部 optional；`new WeiboSDK({})` 行为不变。
  - `config.hooks` / `config.telemetry` 降为内置兼容插件；`logging` 死配置删除。
  - `FetcherService` 不再直接依赖 axios；`deps.client` 通过 `AxiosTransport` 保留。
  - 插件 API 必须显式传入，禁止模块级自动注册（影响 tree-shaking）。
  - 需要 transport contract tests（axios vs fetch）与插件顺序 / 错误语义测试。

## ADR-015: 不采用多账号 token 池轮换

- **日期**: 2026-10-21
- **状态**: accepted
- **决策**: 不实现多账号 cookie / guest token 池；保留 `CredentialResolver` 端口与 `credential_id` 观测字段。若未来确有需求，池以外置插件实现，并强制 `accountScoped` 端点 pin 主凭证。
- **背景**: 需要评估「在账号 token 无关的端点轮换 token」是否能提升吞吐、降低 432。
- **理由**:
  - 真正的「token 无关」端点是 `auth: 'guest'`；换 guest token 不改变数据，而 432 主要打在 IP / 行为维度，池化收益低且额外发 token 请求。
  - 账号级端点（收藏 / 历史评论 / 通知 / @我 / 首页 / 归档）轮换会直接改变数据；非账号级 cookie 端点也会因可见范围不同而改变结果集，违反契约稳定原则。
  - `RateLimitService` 是客户端礼貌限流；不放开并发 / 间隔，换 token 不会提高吞吐；真正需要的是代理池，`config.proxy` 已支持动态 Provider。
  - 项目边界与 `AGENTS.md` 要求只使用自己的账号 Cookie；多账号引入合规与隐私风险。
  - `backlog.md` 已于 2026-10-20 将「多账号登录态隔离」列为不再推进。
- **后果**:
  - 不新增池化代码与状态；`getSession()` / 归档仍按主凭证工作。
  - `CredentialResolver` 保持单实现，telemetry 增加 `credential_id` 为未来留观测基础。
  - 如果未来要恢复，必须新增 ADR，并重新评估 `accountScoped` 标记完整性（`likes.list` 当前未标记）。

## ADR-016: 下游包产物契约与完整性门禁

- **日期**: 2026-10-21
- **状态**: accepted（实施中，见 [todo-plugin-architecture.md](./todo-plugin-architecture.md) 与 [package-integrity.md](../engineering/package-integrity.md)）
- **决策**:
  1. 保持 **ESM-only**，不新增 CJS 构建。
  2. `exports` 全部使用条件对象，`types` 条件优先；新增子路径必须同时有 `types` 与 `default`。
  3. `sideEffects` 必须与真实入口一致：拆分 CLI 命令树与 bin 入口，或使用精确 allowlist。
  4. 补 `engines.node`，与 `process.getBuiltinModule` 的实际要求对齐。
  5. 公共 `.d.mts` 不得引用 axios 类型；zod 类型可由 `z.infer` 别名带出（zod 是运行时 dependency）。
  6. 发布门禁必须基于真实 tarball：`publint` + `attw` + 临时安装 + Node import + `tsc` + Vite/esbuild + tree-shaking。
- **背景**: 包已发布并被 SPA / 用户脚本 / CLI 消费；当前导出测试只检查字段形状，无法发现类型解析、副作用声明、Node 版本、真实打包失败等问题。
- **理由**:
  - 下游最常见的故障不是运行时报错，而是「类型解析不到」「bundler 把入口摇掉」「Edge 里出现 Node builtin」「CJS 误判」。
  - `npm pack` 与源码目录的行为不同（`catalog:`、`files`、条件导出），必须用 tarball 验证。
  - 双包（ESM + CJS）会带来双份类型与状态，收益不足。
- **后果**:
  - 新增 `lint:package` / `verify:package` / `test:bundle` 三个 CI 门禁。
  - `schemas/` 是否随包发布需要明确决策；`$schema` 不能只指向可变的 `main` 分支。
  - 任何新增公共导出 / 子路径 / 运行时依赖，都要同步更新导出测试与产物门禁。