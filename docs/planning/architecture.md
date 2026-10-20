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
- **后果**: 强制流程成本（先抓包再实现），换来 schema 与真实的契约一致性。写入 `CLAUDE.md` 成为硬约束。

## ADR-003: EndpointSpec + Zod 集中校验

- **日期**: 2026-05-16
- **状态**: accepted
- **决策**: 端点定义统一为 `EndpointSpec`（`resourceType` + `endpoint` + `argsSchema` + `buildResource` + `okPolicy` + `schema`），用 `defineEndpoint()` 包装；禁止在 Service 内联 Zod/EndpointSpec。
- **背景**: 早期 schema 散落在 service 文件中，难以统一校验、复用与审阅。
- **理由**: args 类型从 `argsSchema` 自动推导；`request(spec, args)` 统一走 preflight → 请求 → okPolicy → safeParse → hooks/telemetry 全流程。
- **后果**: 端点定义有唯一范式，反模式（内联 schema）被 `CLAUDE.md` 明确禁止。

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