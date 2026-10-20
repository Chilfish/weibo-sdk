# Changelog

这里记录每个版本的公开变化。版本号遵循 SemVer。0.x 阶段仍可能调整 API，破坏性变更会单独标注并给出迁移说明。

## Unreleased

### 新增

- `sdk.getSession()` 返回 `{ uid, details, checkedAt }`。它复用启动自检已经发出的 `profile/detail`，按实例 single-flight 缓存，不额外请求；`refresh: true` 才会重新探测。`checkSession()` 共享同一缓存。
- `capabilities()` 新增 `accountScoped` 标记，标出收藏、历史评论、通知、@我、我的关注等只能读取登录账号自身的能力。

### 修复

- `archive` 的 `includeFavorites` / `includeCommentHistory` 现在校验目标 uid 是否为登录账号。收藏（`all_fav` 忽略 uid）和历史评论（`myCmt` 无 uid）只能读取登录账号自身，跨账号归档会抛 `CONFIG_INVALID`，不再把登录账号的数据静默写进他人归档。
- CLI 批量归档（`--uid-file`）默认不再包含收藏；需要时显式传 `--favorites`（仅当 uid 是登录账号）。
- `media download` 的 `totals` 新增 `planned`：dry-run 下未执行项不再丢失，`downloaded + skipped + failed + planned === total`。

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
