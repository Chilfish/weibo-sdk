# Changelog

本项目遵循语义化版本（SemVer）的约束思路，但在 `0.x` 阶段可能仍会发生 API 调整。任何破坏性变更必须在本文件中明确标注，并给出迁移说明。

## Unreleased

### Docs

- **文档体系重构**：新增 `docs/README.md` 中央索引、`docs/requirements/glossary.md` 术语表、`docs/planning/architecture.md`（ADR-001~012）、`docs/postmortem/` 规范化（索引 + 高频雷区自查清单 + TEMPLATE）、`docs/development-log/` 按天开发日志、`docs/archive/` 归档机制。
- **事实对齐（docs-as-truth）**：`docs/CLI.md`（补全 5 个缺失子命令）、`docs/项目概览.md`（SearchService/endpoint 数/服务清单）、`docs/渐进式开发计划.md`（fixture 清单对齐 31 个文件）、`docs/微博SDK技术规格书_v2.0.md`（重写为与实现一致）。
- **`AGENTS.md` → `CLAUDE.md`**：文件名对齐 Claude Code 规范；新增强制纪律（文档先行、先写 commit message + diff 拆分、写码前读 postmortem 高频雷区）。

### Added

- **ITweet v1 存档契约冻结**（P0-1/K1）：新增 `TWEET_CONTRACT_VERSION`、`ArchiveItem.schemaVersion`、契约冻结文档与形状锁定测试；v1 内只允许新增 optional 字段。
- **媒体契约裁定**（P0-2/K3）：`media[].imageUrl/videoUrl` 明示为上游临时签名 URL（约 1 小时、一次性），SDK 不下载/持久化；`ArchiveItem` 不含 `mediaFiles`。
- **离线契约回归**（P0-5/E5）：`pnpm run validate:fixtures` 遍历 raw fixtures × 对应 schema 做 safeParse，接入 CI；落地时抓到并修复 `specialAttention` 真实漂移。
- **契约卫生**（P0-4）：消 `args as any`；`filterTweets` 改为 `unknown` + `isRawTweet` 收窄；raw 方法标注 `@deprecated`，归一化路径为默认。
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

- **Cookie 来源收口**：CLI / capture / E2E 只从 `.env` 读取 `WEIBO_COOKIE`（默认 `<pwd>/.env`，`--env-file` 可指定），不再回退到可能过期的环境变量；`--cookie` 仍为显式覆盖。
- **结构快照改为通用类型占位**：`stripVolatileKeys` 不再依赖 key 白名单，统一保留 key 路径与 `<STR>/<NUM>/<BOOL>/null`；E2E 与 `schemaDigest` 复用同一实现。
- **版本策略解耦**（P0-3/K2）：契约版本 ≠ 包版本；上游协议漂移走 patch/minor，契约破坏性变更才升 major。0.x 期间 `ITweet` 自 v1 起冻结（P0-6）。
- **raw 边界裁定**：`ArchiveItem` 不携带 raw，下游自行保存；SDK 通过 hooks/回调 + 独立 `enrich` 方法提供 raw/enrich（P1-9）。
- **公开关键词搜索暂缓**：`searchUsers` / `searchTweets` 不再作为候选能力；`searchProfile`（个人主页内按日期搜索）保留。
- **E2E 对齐真实契约**：`listByUserId` 断言改为 `page` 游标；favorites 断言改为 `data.status`；快照按新结构更新。
- **EndpointSpec 泛型签名变更**：`EndpointSpec<TResource, TArgsSchema>` — `TArgsSchema` 替换了旧的 `TArgs`，args 类型现在从 Zod schema 推导。
- SDK 入口不再产生 `console.*` 副作用。
- `FetcherService` 支持依赖注入：`AxiosInstance` / `AuthService` / `RateLimitService` / `hooks` / `telemetry` / `preflight` 均可注入。
- `RateLimitService` 去递归（`while` 循环替代递归等待），并支持注入 `clock` 与 `telemetry`。
- `RateLimitService` 去递归（`while` 循环替代递归等待），支持 fake clock 注入。
- 配置校验错误结构化：缺失 cookie 抛 `InvalidConfigError`。
- `FetcherService.onFetched` 标记为 deprecated（请使用 `config.telemetry` 替代）。

### Removed

- 移除 `size-limit` 体积门禁（`@size-limit/preset-small-lib` 依赖、`size` 脚本与 50 kB 配置），发布门禁不再检查包体积。
