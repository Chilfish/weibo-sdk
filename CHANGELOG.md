# Changelog

本项目遵循语义化版本（SemVer）的约束思路，但在 `0.x` 阶段可能仍会发生 API 调整。任何破坏性变更必须在本文件中明确标注，并给出迁移说明。

## Unreleased

### Docs

- **文档体系重构**：新增 `docs/README.md` 中央索引、`docs/requirements/glossary.md` 术语表、`docs/planning/architecture.md`（ADR-001~012）、`docs/postmortem/` 规范化（索引 + 高频雷区自查清单 + TEMPLATE）、`docs/development-log/` 按天开发日志、`docs/archive/` 归档机制。
- **事实对齐（docs-as-truth）**：`docs/CLI.md`（补全 5 个缺失子命令）、`docs/项目概览.md`（SearchService/endpoint 数/服务清单）、`docs/渐进式开发计划.md`（fixture 清单对齐 31 个文件）、`docs/微博SDK技术规格书_v2.0.md`（重写为与实现一致）。
- **`AGENTS.md` → `CLAUDE.md`**：文件名对齐 Claude Code 规范；新增强制纪律（文档先行、先写 commit message + diff 拆分、写码前读 postmortem 高频雷区）。

### Added

- **Wide Events 遥测系统**：`TelemetryEvent` 扁平 KV 事件（`request_start/success/error`、`rate_limit_wait`、`normalize_done`），含 `trace_id` 全链路追踪。通过 `config.telemetry.emit()` 接入。
- **`defineEndpoint()` helper**：让 endpoint 定义的 args 类型从 `argsSchema` 自动推导，减少类型断言。
- **Endpoint 目录**：将 Zod schema 与 EndpointSpec 定义从 Service 文件中抽离到 `src/services/endpoints/`（`tweet.ts`、`user.ts`），Service 文件只保留业务逻辑。
- **SDK hooks 系统**：`config.hooks.onLifecycle` / `onFetched` / `onError`，覆盖生命周期、请求完成、错误三大阶段。
- **会话自检**：`WeiboSDK.selfCheck()` 与 `checkSession()`，支持 `lazy` / `eager` / `none` 三种自检模式。
- **`WeiboSessionExpiredError`**：Cookie 过期/无效时的结构化业务错误。
- **`UnexpectedAPIResponseError`**：Zod schema 校验失败时的结构化协议错误，含 `zodIssues` 诊断信息。
- **`InvalidConfigError`**：配置校验失败（如缺 cookie）时的结构化错误。
- Offline-first 测试分层：unit/component 默认离线；e2e 需 `WEIBO_E2E=1` 显式开启。
- `UserService` / `TweetService` 的离线组件测试与领域模型归一化测试。
- `Tweet` 归一化 v1：支持 media（pic_infos + mix_media_info）/ pageInfo / geo / retweetedStatus。
- Postmortem 机制：`postmortem/NNN-*.md`。

### Changed

- **EndpointSpec 泛型签名变更**：`EndpointSpec<TResource, TArgsSchema>` — `TArgsSchema` 替换了旧的 `TArgs`，args 类型现在从 Zod schema 推导。
- SDK 入口不再产生 `console.*` 副作用。
- `FetcherService` 支持依赖注入：`AxiosInstance` / `AuthService` / `RateLimitService` / `hooks` / `telemetry` / `preflight` 均可注入。
- `RateLimitService` 去递归（`while` 循环替代递归等待），并支持注入 `clock` 与 `telemetry`。
- `RateLimitService` 去递归（`while` 循环替代递归等待），支持 fake clock 注入。
- 配置校验错误结构化：缺失 cookie 抛 `InvalidConfigError`。
- `FetcherService.onFetched` 标记为 deprecated（请使用 `config.telemetry` 替代）。
