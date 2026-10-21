# Changelog

这里记录每个版本的公开变化。版本号遵循 SemVer。0.x 阶段仍可能调整 API，破坏性变更会单独标注并给出迁移说明。

## Unreleased

### 新增

- 新增结构化日志出口 `config.logger`（默认关闭）。SDK 把已有的 Wide Events 与 `sdk_init` / `self_check_*` 映射为带级别的日志记录，不新增埋点；`WeiboLogger.log()` 抛错或 reject 不影响业务。公共导出新增 `createConsoleLogger` / `createJsonlLogger` / `createMultiLogger` / `createLoggerPlugin`、`WeiboLogger` / `WeiboLogRecord` / `WeiboLogLevel`，内置 sink 默认替换 Cookie / token 等敏感字段。`weibo-cli` 的 stdout 数据与 NDJSON 协议不经过 logger。
- CLI 查询命令新增 `--format`（默认 `json`，可选 `markdown` / `md`），覆盖 `user`、`tweet`、`follow`、`favorite list`、`like list`、`comment mine`、`notification`、`media albums`、`topic`、`trends`、`whoami`，直接输出可读的用户卡片、微博列表、评论、关注列表、热搜等。默认 JSON 与 NDJSON 行为不变；流式命令、`archive` 和 `media download` 不提供该参数。

### 变更

- **BREAKING CHANGE**：`ITweet` / `ITweetComment` 删除 `textHtml`，`TWEET_CONTRACT_VERSION` 升为 `2`；归档记录的 `longText` / `quotedLongText` 一并删除。`statuses/show` 默认带 `isGetLongText=true`，长微博全文已经在 `tweet.text`，无需单独补拉。
  迁移：旧存档记录调用 `migrateTweetV1toV2(record)`（递归删除 `textHtml`）；渲染层用 `text` 配合 `linkCards` / `topics` / `atUsers` / `media` 重建富文本。
- 归档格式升级为 `weibo-user-archive/v2`，`$schema` 指向 `schemas/weibo-user-archive/v2.json`；v1 文件继续用 `schemas/weibo-user-archive/v1.json` 校验。

## 0.3.2 (2026-10-21)

### 新增

- 插件与传输端口：`IWeiboConfig` 新增 `transport` 和 `plugins`。`WeiboTransport` 可以替换默认 axios（`fetchTransport({ fetch })` 适用于 Worker / Edge / Deno / Bun / 测试替身）；插件在构造期组装，支持 `transport` 中间件、`beforeRequest` / `afterResponse` / `beforeRetry` / `onError` 生命周期钩子和只读 `observe`。默认路径不变，`new WeiboSDK({})` 仍然是 axios + 访客身份。公共导出新增 `fetchTransport`、`TransportFailure`、`WeiboPlugin`、`WeiboTransport`、`Credential` / `CredentialResolver` 及相关上下文类型；`credentialId` 只暴露非敏感标识，不做 token 池。
- 归档页内并发预取：`streamArchive({ concurrency })` 与 `weibo-cli archive --concurrency <n>`（默认 3，范围 1–8；`1` 为完全串行）。同一页内并行预取后续条目的评论链和转发首页，分页、产出顺序、`onRaw` 顺序与 checkpoint 语义保持不变；实际 HTTP 并发仍受令牌桶和 432 全局暂停约束。
- `tweets.context()` 在 `statuses/show` 之后并行获取长文、作者资料和评论抽样；`tweets.enrich()` 在需要长文时并行 `statuses/show` 与 `longtext`。评论自身分页仍是串行游标。
- 归档 JSON 增加 `$schema`，指向 `schemas/weibo-user-archive/v1.json`（JSON Schema draft-07）。schema 由 `src/types/archive/IArchiveFile.ts` 生成，可用 `pnpm schema:archive` 重建，`pnpm schema:check` 检查漂移。

### 修复

- `VerificationType` 按真实 `verified_type` 修正：新增 `Unverified = -1`、`Personal = 0`，并补齐政府 / 校园 / 网站 / 应用 / 机构 / 达人等取值；原 `Personal = 1`、`Celebrity = 7` 的映射有误。注意 `Personal` 的数值从 `1` 改为 `0`，`Celebrity` 改名为 `Organization`，依赖旧枚举的代码需要同步。

### 变更

- 包形态与发布门禁：`exports` 补 `types` 条件，新增 `engines.node >= 20.16`；`src/cli.ts` 只导出命令树，新增 `cli-bin.ts` 作为唯一带顶层副作用的 bin 入口，`weibo-cli` 指向 `dist/cli-bin.mjs`。`citty` 构建期内联进 CLI 产物并移到 `devDependencies`，运行时依赖收敛为 `axios` / `zod`。
- 新增 `lint:package`（publint + attw）、`verify:package`（真实 tarball 安装 / Node import / CLI 版本）和 `test:bundle`（Vite + esbuild + tree-shaking + Worker）三个下游产物门禁。
- 移除所有带 `@deprecated` 的兼容 API（0.x 阶段直接 breaking，不再保留旧别名）：
  - `users.info` / `users.details` → `users.fetchRawInfo` / `users.fetchRawDetails`；日常读取用 `users.getById`。
  - `tweets.myMblog` → `tweets.fetchRawUserTimelinePage`（归档层数据源）；日常读取用 `listByUserId` / `streamByUserId`。
  - `tweets.show` 删除 → 归一化用 `getByMblogId`，需要 raw 用 `enrich`。
  - `tweets.friendTimeline` 删除 → `listFriendTimeline` / `streamFriendTimeline`。
  - `config.proxyUrl` 删除 → 统一用 `config.proxy`（静态 URL / 动态 Provider / `false`）。
  - `hooks.onFetched` 删除 → 用 `hooks.onRaw` 获取原始响应，或 `telemetry` 消费 Wide Events。
  - `TweetPageResult.sinceId` 删除 → 用户时间线用 `page`，首页 Feed 用 `maxId`。
  - `ArchiveCheckpoint.lastMblogId` 删除，`ArchivePhase` 不再包含 `'reposts'`；旧 checkpoint 需要重新开始。
  - 内部测试注入 `deps.client` 删除 → 用 `transport: axiosTransport({ client })`（测试内部使用，不在公共导出面）。

### 文档

- Agent 使用方式改为仓库内 `scripts/weibo.sh`，用 bun 直接运行 `src/cli.ts`，不需要构建或安装 npm 包；技能文档补充 CLI 命令树和 SDK 方法参考。
- 浏览器抓包文档收敛为手动 OpenCLI 与 CDP 两条通道，并以 OpenCLI 手册作为选择入口；新增插件扩展与包完整性指南。

### 备注

- 0.3.1 的 tag 已推送但未发布到 npm：CI 的 `browser-smoke --no-browser` 仍在按字符串比较条件 `exports`，在发布步骤前失败。修复后以 0.3.2 发布，并把该检查加入本地发版门禁。

## 0.3.0 (2026-10-21)

### 新增

- 访客模式：`IWeiboConfig.cookie` 变为可选，新增 `auth: 'auto' | 'cookie' | 'guest'`（默认 `auto`）和 `guest` 配置（`token` / `issuer` / `autoRefresh`）。没有 Cookie 时 SDK 自动使用访客身份，可以读取用户资料、单条微博、长文、评论、转发、点赞者、图片墙、视频、相册、超话和热搜。
- 访客模式下，用户时间线、点赞、关注、粉丝改走 m 站容器，只返回第一页：时间线和点赞带 `partial: true`、`hasMore: false`，关注和粉丝的 `next_cursor` 为 `0`；请求第 2 页会报 `CONFIG_INVALID`。m 站微博没有 `mblogid`，SDK 会用数字 `mid` 换算。
- CLI 的每个命令都支持 `--guest`，它不会读取 `.env`。`whoami --guest` 输出 `{ auth, login, tokenIssuedAt, token }`，只包含 token 的发放时间、范围和来源，不打印 token 明文。
- `capabilities()` 和 `weibo-cli capabilities` 增加 `auth`、`guestPagination` 和 `guestNote`，可以直接查询某个能力在访客身份下是否可用、能否翻页。
- `sdk.getSession()` 的返回值增加 `authMode` 和 `guestTokenIssuedAt`；新增 `sdk.authMode` 与 `sdk.getGuestTokenStatus()`。访客 token 由 `visitor.passport.weibo.cn` 发放，按实例缓存并支持并发合并。
- 遥测新增 `guest_token_issue` / `guest_token_error` 事件；请求事件带 `auth_mode` 与 `guest_refresh_count`，鉴权失败事件带 `auth_failure_reason`。
- `sdk.getSession()` 返回 `{ uid, details, checkedAt }`。它复用启动自检已经发出的 `profile/detail`，按实例 single-flight 缓存，不额外请求；`refresh: true` 才会重新探测。`checkSession()` 共享同一缓存。
- `capabilities()` 新增 `accountScoped` 标记，标出收藏、历史评论、通知、@我、我的关注等只能读取登录账号自身的能力。
- 新增 `sdk.tweets.context()` 与 `weibo-cli tweet context`：Agent 视角的单条微博上下文（`weibo.tweet-context/v1`）。它把当前作者正文、转发的原微博、转发链、媒体归属、临时 URL、互动快照和未知项显式分开；`--download-media <dir>` 会回填本地文件路径，便于读取图片。默认不调用任何 LLM，OCR / 视觉描述 / 视频转写由调用方回填。

### 修复

- `archive` 的 `includeFavorites` / `includeCommentHistory` 现在校验目标 uid 是否为登录账号。收藏（`all_fav` 忽略 uid）和历史评论（`myCmt` 无 uid）只能读取登录账号自身，跨账号归档会抛 `CONFIG_INVALID`，不再把登录账号的数据静默写进他人归档。
- CLI 批量归档（`--uid-file`）默认不再包含收藏；需要时显式传 `--favorites`（仅当 uid 是登录账号）。
- `media download` 的 `totals` 新增 `planned`：dry-run 下未执行项不再丢失，`downloaded + skipped + failed + planned === total`。
- `statuses/show?isGetLongText=true` 会重复下发同一条 `url_struct`，`ITweet.linkCards` 现在按短链（无短链时按解析后的 URL）去重，`tweet context` 的「链接」不再重复打印同一张卡片。

### 变更

- `cookie` 不再必填。只有显式 `auth: 'cookie'` 又没有 Cookie 时，构造才会抛 `CONFIG_INVALID`。
- 鉴权模式只由构造时的配置决定：`auto` 在有 Cookie 时使用 Cookie，Cookie 失效后仍然报 `AUTH_SESSION_EXPIRED`，不会静默切换成访客。
- 访客身份下的能力边界显式化：只接受 Cookie 的能力（收藏、通知、@ 我、历史评论、首页关注时间线、日期搜索、微博分组）在发出请求前就返回 `AUTH_SESSION_EXPIRED`，并在 `context.requiredAuth` 标注 `'cookie'`；归档需要完整时间线，访客模式直接报 `CONFIG_INVALID`。
- `tests/fixtures/raw/mobile_*.json` 增加 11 份 m 站第一页真实样本；`scripts/sanitize-raw.mjs` 新增 `--keep-ids`，保留 `mid` / `idstr` / `uid` 等关联键，便于验证 `mblogid` 换算。

### 备注

- 访客能否读到数据取决于微博的匿名策略，第一页之外的翻页目前都被重定向到登录页。
- 公开关键词搜索（`searchUsers` / `searchTweets`）仍是 `unavailable`，访客搜索一并暂缓。
- 媒体下载本来就不带 Cookie，访客身份下同样可用。

### 文档

- 明确归档续跑是 at-least-once：checkpoint 记录最后一条已完整处理项，续跑可能重复边界 1 条，图片墙 / 视频瀑布会重放整页；消费端需按 `mblogId` / `asset.id` 去重。
- 修正 roadmap 中已完成项的过时标记（代理抽象、端点脚手架、抓包助手、capabilities、分页抽象）。

## 0.2.0 (2026-10-20)

这一版把 SDK 从「读取时间线和微博」扩展到「归档一个账号的公开数据」。点赞、历史评论、收藏、媒体、通知和超话都接入了 SDK 与 CLI，归档流支持断点续传、增量、批量以及媒体阶段。

### 新增

- 归档流新增点赞、历史评论、图片墙和视频瀑布。`ArchiveItem.source` 增加 `like`、`comment`、`image`、`video`，媒体资产放在 `item.asset`。
- 新增增量归档、多账号批量归档、仅原创模式和状态文件工具（`parseArchiveState`、`updateArchiveState`、`incrementalOptionsFromState`）。CLI 用 `--state` 自动记录和复用进度。
- 新增评论、转发、二级评论、关注、粉丝、我的关注等 `stream*` 方法。所有流式接口统一支持 `maxItems`、`maxPages` 和跨页去重；时间倒序的流额外支持 `since` / `until`。
- 新增点赞、历史评论、@ 我、评论通知、点赞通知、关注分组、微博分组、超话、热搜、点赞者、图片墙、相册和视频瀑布等数据能力。
- 新增单条微博媒体下载：`media.downloadTweetMedia`、`media.downloadByMblogId` 和 `weibo-cli media download`。支持 dry-run、重试、URL 过期刷新、原子落盘和失败清单。
- `ITweet` v1 增加 `topics`、`linkCards`、`readCount`、`editCount`、`title`、`permanentVideoUrl`、`isOriginal`、`sourceUrl`、`atUsers`、`playCount`、`isTop`、`audio` 和 `repostChain` 等可选字段。
- `ITweet` v1 卡片元数据补齐：`TweetPageCard` 增加 `objectId` 和 `subtitle`，`TweetLinkCard` 增加 `longUrl`、`oriUrl` 和 `urlType`。`pageInfo.pagePic` 的 `http://` 地址统一升级为 `https://`，避免 https 页面被混合内容拦截。
- `ITweetComment` 增加 `pics`，用于图片评论；`IUser` 增加 `svip`、`mbrank`、`hometown` 和 `labelDesc`。
- 所有接受 `mblogId` 的方法现在也接受数字 mid 和微博状态 URL。新增 `parseTweetIdInput` 和 `normalizeTweetIdInput`。
- 新增 `RateLimitError`（HTTP 432 / 429）、请求级指数退避重试，以及 432 后暂停全局令牌桶。
- CLI 补齐上述能力的子命令，并统一错误输出为 JSON 错误信封。新增 `capabilities` 和 `schema diff`。
- 新增 `pnpm new:endpoint`、`pnpm capture:endpoint`、`playground/` 场景示例和 `.agents/skills/weibo-sdk/SKILL.md`。

### 修复

- 评论请求不再发送 `type=feed`。带上这个参数时，微博首屏只返回 3 条评论，`ok`、`total_number` 和 `max_id` 看起来仍然正常，很容易漏掉。
- 评论流的停止条件改为空页、`max_id` 缺失或不再前进。顶层 `total_number` 包含楼中楼和不可见评论，不能作为剩余条数。
- 首页 Feed 改用 `max_id` 翻旧页，`since_id` 只做增量过滤。同时移除了默认发送的 `list_id`，该分组在当前账号下已不存在。
- 修复 `weibo-cli tweet comments --max-id` 被 citty 丢弃、翻页始终返回首屏的问题。
- `mymblog` 的 `since_id` 现在同时接受数字和带后缀的字符串。
- `favorite list --page 0` 不再把非法页码传给微博导致 HTTP 400。

### 升级提示

- 0.1.x 的公开 API 仍然可用，没有必须修改的调用。
- `listFriendTimeline` 的翻页游标改为 `maxId`。旧的 `sinceId` 字段仍保留，但已标记为 deprecated。
- 收藏列表的 `hasMore` 优先使用 `total_page`，避免把已删除的收藏算进剩余页数。

## 0.1.1 (2026-10-20)

修复 0.1.0 的安装问题。0.1.0 使用 `npm publish` 发布，npm 没有重写 pnpm 的 `catalog:` 依赖，消费者安装时会报 `EUNSUPPORTEDPROTOCOL`。0.1.0 已撤下，0.1.1 改用 `pnpm publish` 重新发布，依赖写入为具体版本。

同时给 `prepublishOnly` 加了发布工具检查：使用 `npm publish` 会直接失败，并提示改用 `pnpm publish`。详见 [postmortem 010](./docs/postmortem/010-npm-publish-catalog-protocol.md)。

## 0.1.0 (2026-10-20)

首个公开版本。

- 分层架构：`WeiboSDK` 门面、领域服务、`FetcherService` / `AuthService` / `RateLimitService`，以及集中的 EndpointSpec 和 Zod 校验。
- 领域模型 v1：用户、微博、媒体、分页结果和归档条目。`ITweet` 从 v1 起保持稳定，后续只增加可选字段。
- 归档流：`streamArchive` 支持时间线、转发、收藏、评论和日期切片，带 checkpoint、进度事件和单条失败策略。
- 可观测性：请求、限流、归一化和自检都有结构化遥测事件，支持 `trace_id`。
- 错误体系：传输、协议和业务错误统一带有 `code`、`level`、`retryable`、`context`。
- 浏览器构建：提供 `@chilfish/weibo-sdk/browser` 子路径。
- 离线测试：默认 `pnpm test` 不访问网络；真实网络用例通过 `WEIBO_E2E=1` 单独开启。
