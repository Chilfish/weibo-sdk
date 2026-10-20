# Changelog

本项目遵循语义化版本（SemVer）的约束思路，但在 `0.x` 阶段仍可能发生 API 调整。任何破坏性变更必须在本文件中明确标注，并给出迁移说明。

## Unreleased

### Added

- **收藏流式分页**（D3）：新增 `sdk.favorites.listFavorites(uid, { page?, tag? })` 与 `streamFavorites(uid, { page?, tag?, maxPages?, onProgress? })`，自动翻页、跨页去重、整页重复保护，并归一化为 `Tweet`；`FavoritePageResult` 带 `hasMore` / `total` / `totalPages`。
- **收藏标签过滤**：按收藏项自带的 `tags` 做客户端精确匹配（id 或名称）。线上实测 `all_fav` 会忽略 `tag_id` / `tag` 参数。
- 新增 CLI `weibo-cli favorite stream <uid> [--page] [--tag] [--max-pages]`，输出 `progress` / `item` / `done` NDJSON。
- `favorites/all_fav` schema 补充顶层 `count` / `total_page` 与收藏项 `tags` 字段（均为 optional）。
- **Cookie 文件输入**：`IWeiboConfig.cookie`、CLI `--cookie` 与 `.env` 的 `WEIBO_COOKIE` 现在也接受完整文件路径，自动识别 Netscape `cookies.txt`（7 列 TSV，支持 `#HttpOnly_`）与 header 串内容（可带 `Cookie:` 前缀、可多行）。仅保留 `weibo.com` / `weibo.cn` / `sina.com.cn` 域名 Cookie 并跳过过期条目；路径不存在 / 无可用 Cookie 抛 `InvalidConfigError`（`CONFIG_INVALID`）。浏览器运行时不支持文件路径（无 `node:fs`），按普通字符串处理。
- **日期参数支持可读格式**：`tweets.searchByDate` 的 `starttime` / `endtime` 与 CLI `tweet search-profile --starttime/--endtime` 除 unix 秒外，接受 `YYYY-MM-DD` / `YYYYMMDD`（start 取当天 00:00:00、end 取当天 23:59:59，运行环境本地时区）；请求前统一换算为上游要求的 unix 秒。非法日期 / 无法识别的格式抛 `InvalidConfigError`（`CONFIG_INVALID`），不再把会被上游静默忽略的字符串发出去。

### Fixed

- `weibo-cli favorite list --page 0`（及其他非法页码）不再把 `0` 透传给上游导致 HTTP 400；`page < 1` / 非有限数按第一页处理。

## 0.1.1 (2026-10-20)

### Fixed

- **npm 产物可安装性**：0.1.0 由 `npm publish` 发布，未重写 pnpm `catalog:` 依赖，消费者安装报 `EUNSUPPORTEDPROTOCOL`。0.1.0 已 unpublish，0.1.1 改用 `pnpm publish` 重新发布（依赖重写为 `axios ^1.20.0` / `citty ^0.2.2` / `zod ^4.5.4`）。
- `prepublishOnly` 增加发布工具守卫：使用 `npm publish` 会直接失败并提示改用 `pnpm publish`（见 [postmortem 010](./docs/postmortem/010-npm-publish-catalog-protocol.md)）。

## 0.1.0 (2026-10-20)

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
- **raw / enrich 访问 API**（P1-9/K5）：新增请求级 `config.hooks.onRaw(raw, meta)`（Zod 校验前触发，失败响应也可获取）、归档级 `streamArchive(uid, { onRaw })`（逐原始项）与 `tweets.enrich(mblogId) → { tweet, raw, longText? }`；`ArchiveItem` 保持 v1 形状、不携带 raw。
- **归档日期切片**（P1-5/R5）：`streamArchive` 在 mymblog page 翻到底后自动用 `searchProfile` 按日期切片补齐更早内容，单片 `total` 超过 `maxSliceItems` 时对半缩小窗口；新增 `timelineSource` / `includeDateSlices` / `since` / `until` / `sliceWindow` / `maxSliceItems` 选项与 `sliceEnd` / `slicePage` / `sliceWindow` checkpoint 游标。大号（万条级）完整镜像成立。
- **归档进度事件**（P1-3/R3）：`streamArchive({ onProgress })` 每页/每阶段给出 `{ processed, total?, remaining?, phase, source, page }`；telemetry 新增 `archive_progress` Wide Event；CLI 输出 `progress` NDJSON，`item`/`done` 事件带 `count/total/remaining`。
- **单条失败策略**（P1-4/R4）：`streamArchive({ onItemError, repostErrorPolicy, commentsErrorPolicy, maxRetries, retryDelayMs })`；转发/评论单页失败默认 `skip` 并继续，仅 `retryable` 结构化错误会重试；telemetry 新增 `archive_item_error`。
- **评论归档**（P1-6/K4）：`streamArchive({ includeComments: true })` 分页拉取评论并挂到 `tweet.comments`（`ITweetComment[]`，含楼中楼 `replies`）；`ITweet` v1 新增 optional `comments` 字段，favorite 项不拉取。CLI 新增 `--comments` / `--comment-pages`。
- **浏览器构建**（P2-1/K6）：新增 `dist/browser.mjs`（platform browser，自包含 ESM）与 `@chilfish/weibo-sdk/browser` 子路径导出；`proxyUrl` 在浏览器运行时不再注入 axios `proxy`；新增 `pnpm run smoke:browser` 真实 Chromium 冒烟脚本。
- **Telemetry JSONL 消费端**（P2-3/E4）：新增 `createJsonlTelemetry` / `formatArchiveProgress` 与 `examples/telemetry-jsonl.mjs`，一行一事件、永不抛错，可直接作为 `config.telemetry` 接入长任务进度 UI。
- **SDK hooks 系统**：`config.hooks.onLifecycle` / `onFetched` / `onError`，覆盖生命周期、请求完成、错误三大阶段。
- **会话自检**：`WeiboSDK.selfCheck()` 与 `checkSession()`，支持 `lazy` / `eager` / `none` 三种自检模式。
- **`WeiboSessionExpiredError`**：Cookie 过期/无效时的结构化业务错误。
- **`UnexpectedAPIResponseError`**：Zod schema 校验失败时的结构化协议错误，含 `zodIssues` 诊断信息。
- **`InvalidConfigError`**：配置校验失败（如缺 cookie）时的结构化错误。
- Offline-first 测试分层：unit/component 默认离线；e2e 需 `WEIBO_E2E=1` 显式开启。
- `UserService` / `TweetService` 的离线组件测试与领域模型归一化测试。
- `Tweet` 归一化 v1：支持 media（pic_infos + mix_media_info）/ pageInfo / geo / retweetedStatus。
- Postmortem 机制：`postmortem/NNN-*.md`。
- [docs/planning/todo-post-0.1.0.md](./docs/planning/todo-post-0.1.0.md)：0.1.0 发布收口 + 0.2.0 用户数据丰富度、可靠性、端点 DX 的完整行动清单（点赞 / 历史评论 / 媒体集合 / 增量 / 批量 / 432 / Agent 等）。
- [docs/engineering/endpoint-authoring.md](./docs/engineering/endpoint-authoring.md)：端点开发指南（抓包 → schema → spec → service → CLI → 测试 → 文档；分页约定与高频雷区）。
- 包身份回归测试：断言 `package.json#name` 与 `bin.weibo-cli`。

### Changed

- **Cookie 来源收口**：CLI / capture / E2E 只从 `.env` 读取 `WEIBO_COOKIE`（默认 `<pwd>/.env`，`--env-file` 可指定），不再回退到可能过期的环境变量；`--cookie` 仍为显式覆盖。
- **结构快照改为通用类型占位**：`stripVolatileKeys` 不再依赖 key 白名单，统一保留 key 路径与 `<STR>/<NUM>/<BOOL>/null`；E2E 与 `schemaDigest` 复用同一实现。
- **版本策略解耦**（P0-3/K2）：契约版本 ≠ 包版本；上游协议漂移走 patch/minor，契约破坏性变更才升 major。0.x 期间 `ITweet` 自 v1 起冻结（P0-6）。
- **归档 checkpoint 瘦身 + 转发内联**（P1-1/P1-2）：`ArchiveCheckpoint` 删除 `visitedMblogIds`（checkpoint 大小恒定），改用 `page`（当前页）+ `lastTimelineMblogId` 游标；reposts 改为 timeline 阶段内联拉取，删除 `collectTimelineMblogIds` 全量重放；旧 `phase:'reposts'` checkpoint 自动兼容。
- **raw 边界裁定**：`ArchiveItem` 不携带 raw，下游自行保存；SDK 通过 hooks/回调 + 独立 `enrich` 方法提供 raw/enrich（P1-9）。
- **公开关键词搜索暂缓**：`searchUsers` / `searchTweets` 不再作为候选能力；`searchProfile`（个人主页内按日期搜索）保留。
- **`searchByDate` 日期参数改为 unix 秒**：`starttime` / `endtime` 传 **unix 秒**（类型 `number | string`，字符串仅兼容透传）；日期字符串会被上游静默忽略。真实网页端请求为 `searchProfile?...&starttime=<秒>&endtime=<秒>`。
- **E2E 对齐真实契约**：`listByUserId` 断言改为 `page` 游标；favorites 断言改为 `data.status`；快照按新结构更新。
- **EndpointSpec 泛型签名变更**：`EndpointSpec<TResource, TArgsSchema>` — `TArgsSchema` 替换了旧的 `TArgs`，args 类型现在从 Zod schema 推导。
- SDK 入口不再产生 `console.*` 副作用。
- `FetcherService` 支持依赖注入：`AxiosInstance` / `AuthService` / `RateLimitService` / `hooks` / `telemetry` / `preflight` 均可注入。
- `RateLimitService` 去递归（`while` 循环替代递归等待），并支持注入 `clock` 与 `telemetry`。
- `RateLimitService` 去递归（`while` 循环替代递归等待），支持 fake clock 注入。
- 配置校验错误结构化：缺失 cookie 抛 `InvalidConfigError`。
- `FetcherService.onFetched` / `config.hooks.onFetched` 标记为 deprecated（请使用 `onRaw` 或 `config.telemetry` 替代）。
- **包名与 CLI 发布身份**：改为 `@chilfish/weibo-sdk`；CLI 二进制改为 `weibo-cli`；新增 `publishConfig.access = public`（scoped 包首发）。
- README / CLI 文档 / 示例的安装、import、子路径与命令示例同步为 `@chilfish/weibo-sdk` / `weibo-cli`。

### Removed

- 移除 `size-limit` 体积门禁（`@size-limit/preset-small-lib` 依赖、`size` 脚本与 50 kB 配置），发布门禁不再检查包体积。

### Fixed

- **CLI `archive` 负向开关**：`--no-reposts` / `--no-favorites` / `--no-date-slices` 因 citty `--no-X` 语义失效（读到的始终是 `undefined`）；改为正向布尔 + `resolveArchiveIncludeFlags()` 映射，并在每产出一项时落盘 checkpoint（Ctrl+C 中断后可续传）。
- **E2E 结构快照稳定性**：列表端点只快照响应信封，单条端点改用固定 mblogId（`QqsYymYOS` / `P6yhlzD3j` / 长文 `RcbHecsos`），避免上游内容变化导致快照漂移。
