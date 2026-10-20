# Changelog

本项目遵循语义化版本（SemVer）的约束思路，但在 `0.x` 阶段仍可能发生 API 调整。任何破坏性变更必须在本文件中明确标注，并给出迁移说明。

## Unreleased

### Added

- **公共流式分页（0.2 DX）**：新增 `tweets.streamComments` / `streamReplies` / `streamReposts`、`followings.streamFollowings` / `streamFans` / `streamMyFollowings`；统一「空页 / 整页重复 / 游标不前进 / maxPages」停止语义（分页型端点另可按 total 提前停止；评论流的 total 含楼中楼，不参与停止）。CLI 新增 `tweet comments-stream|replies|replies-stream|reposts-stream`、`follow stream|fans-stream|my-stream`。
- **通用分页器 `paginate()`**（`src/utils/pagination.ts`）：page / cursor / since_id / max_id 共用实现，支持跨页去重、进度回调与 `maxPages`。
- **二级评论（D13）**：`tweets.replies` / `streamReplies`（`is_reply=1` + `fetch_level=1`，请求 `id=<一级评论 id>`）；CLI `tweet replies|replies-stream`。`buildComments` args 增加 `is_reply`。
- **个人主页关键词搜索（D12）**：`searchProfile` 增加 `q`；`tweets.searchByDate({ q })` 与 `weibo-cli tweet search-profile --q`；`ArchiveStreamOptions.searchQuery` 让日期切片按关键词过滤。
- **归档媒体集成（D4/D5）**：`streamArchive({ includeImages, includeVideos })`；`ArchiveItem.source` 新增 `'image' | 'video'`，媒体资产在 `item.asset`（image 项可能没有 `item.tweet`）；checkpoint 新增 `imagesCursor` / `videosCursor`；CLI `archive --images --videos`。
- **归档增量模式**：`streamArchive({ incremental: { since?, stopAtMblogId?, skipPinned? } })`，仅作用于 timeline；置顶微博不参与时间边界。
- **多账号批量归档**：`sdk.archive.streamUsersArchive(uids, options)`（按 uid 串行、独立 checkpoint、单用户失败策略）；CLI `archive --uid-file <path>`。
- **仅原创归档**：`streamArchive({ originalOnly: true })` 跳过转发微博并关闭内联转发。
- **增量状态文件**：新增 `src/utils/archiveState.ts`（`parseArchiveState` / `updateArchiveState` / `incrementalOptionsFromState`）；CLI `archive --state <file>` 自动记录/复用 `lastMblogId` / `lastCreatedAt`。
- **能力清单**：新增 `WEIBO_CAPABILITIES` / `listCapabilities()` / `sdk.capabilities()` 与 `weibo-cli capabilities`，输出服务 / 方法 / 登录要求 / 分页类型 / 状态。
- **代理抽象（ProxyProvider）**：`IWeiboConfig.proxy` 支持静态 URL、`false` 或 `{ getProxy(ctx) }` 动态 Provider（每次请求/重试解析，支持 Basic Auth）；`proxyUrl` 保留为 deprecated 兼容。
- **Cookie 失效诊断**：`ok === -100` / 登录类 message 映射为 `WeiboSessionExpiredError`（`AUTH_SESSION_EXPIRED`），非 JSON 登录页映射为 `API_BAD_RESPONSE`；两者均带 `hint` / `next` 下一步。CLI 未捕获错误统一输出 `{ event:'error', code, level, retryable, message, hint?, next?, context? }`。
- **schemaDigest 漂移报告**：新增 `diffSchemaDigest()` / `formatSchemaDrift()` 与 `weibo-cli schema diff <before> <after>`。
- **端点开发工具**：`pnpm new:endpoint <domain>/<name>` 生成 EndpointSpec 骨架；`pnpm capture:endpoint <url>` 抓取真实响应、脱敏、写 fixture 并追加 `INDEX.md`。
- **Agent / 分发文档**：新增 [`.agents/skills/weibo-sdk/SKILL.md`](./.agents/skills/weibo-sdk/SKILL.md)（按 skill-creator 模板：指令 / 示例 / 故障排除 / 边界）与 [AGENTS.md](./AGENTS.md#agent-使用速查sdk--cli) 的「Agent 使用速查」（安装、登录、常用命令、分页、错误码、安全边界）。不提供 `llms.txt`（本项目不暴露 HTTP 服务）。
- **ITweet v1 可选字段（第二批）**：`atUsers`（从 `text` HTML 锚点解析）、`playCount`（仅 `online_users` 含「次观看」）、`isTop`（`isTop === 1`）、`audio`（`page_info` / `mix_media_info` 播客音频）。新增 `TweetAtUser` / `TweetAudio` 类型。
- **IUser 可选字段**：`svip` / `mbrank` / `hometown` / `labelDesc`（含 `IUserLabel` 深浅色配色）。
- **Fixture**：新增 `searchProfile_q` / `comment_replies_*` / `mymblog_pinned` / `at_status` / `audio_status` / `image_wall_with_albums` / `album_*` / `stopic_*` / `profile_detail_hometown`，并在 `FIXTURE_RULES` 登记（`album_detail_*` / `stopic_*` 为 mapped；`album_list` 因 mobile containerid 不兼容保留 unmodeled）。
- **相册（D4）**：`media.listAlbums(uid)`（`getImageWall?has_album=true` 的 `album_list`）与 `listAlbumPhotos` / `streamAlbumPhotos`（`getAlbumDetail`，`since_id` 游标）；CLI `media albums|album`。
- **超话（D7）**：新增 `TopicService` / `sdk.topics`（`cates` / `list` / `stream`）；CLI `topic cates|list|stream`。`stopic/list` 的 `count` 为总页数。
- **首页「最新微博」增量**：`listFriendTimeline` 改用 `max_id` 翻旧页（响应 `max_id`；`0` = 到底），`since_id` 仅做增量过滤；新增 `streamFriendTimeline` 与 CLI `tweet home-stream`。`TweetPageResult` 新增 optional `maxId` / `total`。
- **结构化限流错误 `RateLimitError`**（P1 可靠性）：HTTP **432**（微博风控）/ **429** 统一映射为 `code: 'RATE_LIMITED'`（`level: 'transport'`、`retryable: true`），`context` 携带 `status` / `retryAfterMs?` / `attempt` / `message?`；不再与 4xx/5xx 混在 `NET_REQUEST_FAILED` 里。
- **请求级重试（指数退避 + jitter）**：新增可选 `IWeiboConfig.retry = { retries?, baseDelayMs?, maxDelayMs?, retryOn? }`（默认 `retries: 2`、`baseDelayMs: 500`、`maxDelayMs: 8000`、四类全开）。覆盖 `rate_limit`（432/429）/ `server_error`（5xx）/ `timeout` / `network_error`（无响应的连接类失败）；支持 `Retry-After`（秒或 HTTP date，受 `maxDelayMs` 截断）；`retries` 归一化到 `[0, 10]`，`0` 即关闭；不可重试错误（其余 4xx / `API_NOT_OK` / `API_BAD_RESPONSE` 等）永不重试。
- **432 后暂停全局令牌桶**：`RateLimitService.pause(ms)` + `acquire()` 先等暂停结束再取令牌，避免并发请求同时撞墙；暂停期等待以 `rate_limit_wait.reason = 'rate_limited'` 记录。
- 新增 telemetry 事件 `request_retry`（`attempt / max_attempts / delay_ms / reason / status? / error_*`）；`request_error` 新增可选 `attempt`，`rate_limit_wait` 新增可选 `reason`。
- 新增 `tests/testkit/telemetryCollector.ts`（`TelemetryCollector`）并收敛测试内重复实现。
- **点赞服务（D1）**：新增 `sdk.likes.listByUserId(uid, { page? })` 与 `streamByUserId(uid, { page?, maxPages?, onProgress? })`。真实端点为 `/ajax/statuses/likelist`（page 型、只有 `data.list`，越界页返回空数组）；自动翻页按空页 / 整页重复 / `maxPages` 停止，并跨页去重。CLI `weibo-cli like list|stream <uid>`。
- **历史评论服务（D2）**：新增 `sdk.commentHistory.listMine({ maxId?, page? })` 与 `streamMine({ maxPages?, onProgress? })`。真实端点为 `/ajax/message/myCmt`，用 `max_id=<上一页 next_cursor>` 翻页、`next_cursor === 0` 停止；只读当前登录用户自己的评论。`ITweetComment` 在 v1 契约内新增 optional `rootId` / `replyTo` / `floorNumber` / `totalReplies` / `liked` / `parentMblogId`。CLI `weibo-cli comment mine|stream`。
- **收藏流式分页**（D3）：新增 `sdk.favorites.listFavorites(uid, { page?, tag? })` 与 `streamFavorites(uid, { page?, tag?, maxPages?, onProgress? })`，自动翻页、跨页去重、整页重复保护，并归一化为 `Tweet`；`FavoritePageResult` 带 `hasMore` / `total` / `totalPages`。
- **收藏标签过滤**：按收藏项自带的 `tags` 做客户端精确匹配（id 或名称）。线上实测 `all_fav` 会忽略 `tag_id` / `tag` 参数。
- 新增 CLI `weibo-cli favorite stream <uid> [--page] [--tag] [--max-pages]`，输出 `progress` / `item` / `done` NDJSON。
- `favorites/all_fav` schema 补充顶层 `count` / `total_page` 与收藏项 `tags` 字段（均为 optional）。
- **Cookie 文件输入**：`IWeiboConfig.cookie`、CLI `--cookie` 与 `.env` 的 `WEIBO_COOKIE` 现在也接受完整文件路径，自动识别 Netscape `cookies.txt`（7 列 TSV，支持 `#HttpOnly_`）与 header 串内容（可带 `Cookie:` 前缀、可多行）。仅保留 `weibo.com` / `weibo.cn` / `sina.com.cn` 域名 Cookie 并跳过过期条目；路径不存在 / 无可用 Cookie 抛 `InvalidConfigError`（`CONFIG_INVALID`）。浏览器运行时不支持文件路径（无 `node:fs`），按普通字符串处理。
- **日期参数支持可读格式**：`tweets.searchByDate` 的 `starttime` / `endtime` 与 CLI `tweet search-profile --starttime/--endtime` 除 unix 秒外，接受 `YYYY-MM-DD` / `YYYYMMDD`（start 取当天 00:00:00、end 取当天 23:59:59，运行环境本地时区）；请求前统一换算为上游要求的 unix 秒。非法日期 / 无法识别的格式抛 `InvalidConfigError`（`CONFIG_INVALID`），不再把会被上游静默忽略的字符串发出去。
- **用户媒体集合（D4 / D5）**：新增 `sdk.media.listImages` / `streamImages`（图片墙，`sinceid` 游标）与 `listVideos` / `streamVideos`（视频瀑布，`cursor` 游标）。新增领域模型 `IUserMediaAsset`（`id` / `type` / `url` / `coverUrl?` / `videoUrl?` / `duration?` / `createdAt?` / `sourceMblogId?` / `permanentPageUrl?` 等）；图片 URL 由 `pid` 构造，视频从 `page_info.media_info` 提取。CLI 新增 `weibo-cli media images|videos <uid>`。
- `normalizeTweet` 现在也识别 `page_info.media_info` 形态的视频（视频瀑布 / 部分详情页），归一化进 `Tweet.media`。
- **归档接入点赞与历史评论（D1 / D2）**：`streamArchive({ includeLikes: true, includeCommentHistory: true })`。阶段顺序 `timeline → likes → comments → favorites`；`ArchiveItem.source` 新增 `'like' | 'comment'`，评论项带 `item.comment`（`item.tweet` 为被评论微博）；`ArchiveCheckpoint` 新增 `likesPage` / `commentHistoryCursor`（按阶段删除无关字段，保持恒定大小）；新增 `likesErrorPolicy` / `commentHistoryErrorPolicy`（默认 `abort`）。CLI `archive` 新增 `--likes` / `--comment-history`。
- **微博点赞者（D8）**：新增 `sdk.tweets.likers(mid, { page? })` 与 `streamLikers(mid, { page?, maxPages?, onProgress? })`，返回 `TweetLiker`（简版用户 + `likedAt` / `source`）。网页端 `ajax/statuses/likeShow` 实测仍返回正确 `total_number` 但 `data` 恒为空，SDK 改用 `m.weibo.cn/api/attitudes/show`（page 型；越界页 `data: null`）。CLI `tweet likers|likers-stream`。
- **@我的微博（D9）**：新增 `sdk.users.listMentions({ maxId?, page? })` 与 `streamMentions(...)`。端点 `/ajax/statuses/mentions`，用 `max_id=<上一页 next_cursor>` 翻页（`since_id` 被忽略），`next_cursor === 0` 停止。CLI `user mentions|mentions-stream`。
- **消息通知（D10）**：新增 `sdk.notifications.listComments/streamComments`（`/ajax/message/cmt`）与 `listLikes/streamLikes`（`/ajax/message/attitudes`）。评论通知输出 `{ comment, tweet }`，点赞通知输出 `{ id, createdAt, attitude, source, user, tweet }`；缺失 `status`（原微博已删）的条目会被跳过。`message/count` / `message/likeNotice` 已失效，不提供未读数。CLI `notification comments|comments-stream|likes|likes-stream`。
- **关注分组 / 微博分组（D11）**：新增 `sdk.users.groups()`（`feed/allGroups` 分类拍平）与 `mblogGroups()`（`mblog/querygroup` 的 `join_groups`）。CLI `user groups|mblog-groups`。
- Fixture（D8–D11）：`likers_p1/p2/end`、`mentions_p1/p2/end`、`message_cmt_p1/p2/end`、`message_attitudes_p1/p2/end`、`mblog_groups`、`feed_groups`，ID 使用确定性假值并保留真实分页游标。
- **单条微博媒体下载辅助**：新增 `sdk.media.downloadTweetMedia(tweet, options)` 与 `downloadByMblogId(mblogId, options)`，CLI `weibo-cli media download <mblogId>`。扁平命名 `<mblogId>-<index>-<mediaId>.<ext>`（LivePhoto 动态帧 `-motion`）；独立 CDN 客户端只带微博域名 Referer、不携带 Cookie，主机后缀白名单；临时文件 + 原子 rename、字节上限、空闲超时、Content-Length 校验、重试退避、403/404/410 单飞刷新；失败聚合到 `<mblogId>-media-errors.json`。新增错误码 `MEDIA_DOWNLOAD_FAILED` / `MEDIA_BAD_RESPONSE` / `MEDIA_STORAGE_FAILED`（`level: 'storage'`）。
- **`ITweet` v1 可选字段扩充（只增不改）**：新增 `topics`（话题）、`linkCards`（`url_struct[]` 链接/超话卡片）、`readCount`、`editCount`、`title`（顶栏标题）、`permanentVideoUrl`、`isOriginal`、`sourceUrl`（网页永久链接）。均由真实 fixture 驱动（feed_home / favorites / likes / searchProfile / waterfall / mymblog），未映射项（`atUsers` / `playCount` / `isTop` / `audio`）保持缺省。

### Fixed

- **评论区静默降级修复**：`buildComments` 不再发送 `type=feed`。2026-10-20 真实浏览器抓包确认，带该参数时上游首屏只返回 3 条（`ok` / `total_number` / `max_id` 仍正常），去掉后首屏恢复 20 条；`buildCommentsSpec` 的 `.strict()` args 同步移除 `type`。`flow=1`（按时间）要求数字 mid，字母 mblogid 会 400，`comments()` / `streamComments()` 现在自动用 `statuses/show` 解析（流式只解析一次）。
- **评论流停止条件修正**：顶层 `total_number` 含楼中楼 / 不可见评论，不能作为结束条件；`streamComments` / `streamReplies` 改为仅按「空页 / 整页重复 / `max_id` 缺失或 0 或 不前进 / maxPages」停止。hot 排序可能先返回空页（`max_id` 仍非 0），按空页停止。
- `buildComments` 响应 schema 增加 `trendsText` / `tip_msg`（如「博主已开启防火墙，部分内容暂不展示」），便于消费方识别部分可见。
- `tweets.friendTimeline` 不再默认发送硬编码的 `list_id`（`4665452701982436`）。2026-10-20 实测缺省 `list_id` 同样返回默认首页 Feed，该 id 在当前账号分组中已不存在；需要指定分组时显式传 `list_id`。
- `mymblog` 的 `data.since_id` 真实类型现在可能是 `number` 或带后缀的 `string`（如 `"...kp2"`），schema 由 `string` 放宽为 `z.union([z.string(), z.number()])`，避免真实响应被误判为 `API_BAD_RESPONSE`；同步更新 raw 类型与 fixture（`mymblog_page1_since_id_numeric.json`）。该漂移是账号相关的：部分账号 `since_id` 与 `page` 分页等价、`total` 为真实总数，另一些账号仍返回 `""` + `-1`。
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
- [docs/archive/todo-post-0.1.0.md](./docs/archive/todo-post-0.1.0.md)：0.1.0 发布收口 + 0.2.0 用户数据丰富度、可靠性、端点 DX 的完整行动清单（已归档）。
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
