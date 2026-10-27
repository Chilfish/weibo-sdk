# Changelog

公开变更记录，版本号遵循 SemVer。

## Unreleased

## 0.7.0 (2026-10-27)

### 变更

- **破坏性**：`ITweet` 契约升到 v3，归档格式升到 `weibo-user-archive/v3`。移除 `readCount` / `playCount` / `editCount` / `isTop` / `isOriginal`，升级后需要改读取代码：
  - `readCount` / `playCount` / `editCount` → `stats.reads` / `stats.plays` / `stats.edits`。
  - `isTop` / `isOriginal` → `flags.pinned` / `flags.original`。
  - 归档文件的 `schema` 从 `weibo-user-archive/v2` 变为 `weibo-user-archive/v3`；`mergeArchiveFiles` 与 `weibo-cli archive merge` 仍能读取 v2 归档，记录自动迁移，输出统一为 v3。

### 新增

- `ITweet` 新增 `flags`（推广 / 付费 / 编辑状态）、`editedAt`、`tags`、`superTopic`、`contentNotices`、`stats.favorites`。
- 媒体新增 `focusPoint`（客户端裁剪焦点），页面卡片新增 `summary`。

## 0.6.1 (2026-10-27)

### 新增

- `userArchive` 新增 `resume: 'strict' | 'merge'`（默认 `strict`）。`merge` 保留已有记录（按 `mblogId`），
  按本次范围重建切片计划并重新枚举，只补缺失的补全；省略的内容选项仍沿用 journal，但 `since` / `until`
  不继承。适合「最近 N 天」这类按当天日期重算的相对范围。CLI 对应 `--resume merge`。
- 新增 `ResumeMismatchError` / `RESUME_MISMATCH`：续跑配置与 journal 不一致时单独报错，
  `context.field = 'resume'`、`context.mismatch` 指向冲突字段（`uid` / `since` / `until` / `sliceDays` /
  `options` / `slices`）。`ResumeMismatchError` 继承 `InvalidConfigError`，原有 `instanceof` 判断仍然成立。

### 修复

- 范围归档续跑时 `loadRecords()` / `loadIssues()` 改为扫描进度目录下的全部切片 journal，
  不再只读当前 `meta.slices`。`resume: 'merge'` 重写切片计划后，旧切片的记录与 issue 不会丢失。

## 0.6.0 (2026-10-23)

### 新增

- 公开文档站：指南、API 参考、CLI、契约与格式。
- 归档 JSON Schema 随包发布，可离线校验。
- 新增 `tweets.context`、`tweets.replies` / `streamReplies`、`tweets.longText`。
- 每周一次的 `Upstream Drift` 工作流：无 Cookie 的访客冒烟直连真实上游，配置 `WEIBO_COOKIE` secret 后额外跑完整 E2E。
- `pnpm test:coverage` 成为 CI 门禁（v8 覆盖率，阈值只允许上调）。
- `pnpm check:api` 新增方法层级校验：公开方法里的 `fetchRaw*` 必须登记在 `api-surface.json` 的
  `methodTiers.evolving`，新增 raw 方法未登记会失败。

### 变更

- **破坏性**：公开方法统一返回 camelCase 领域模型；上游 snake_case 响应只通过显式 `fetchRaw*` 获取。
  - `tweets.comments` / `replies` → `TweetCommentsPageResult`
  - `tweets.getReposts` → `TweetRepostsPageResult`
  - `tweets.longText` → `TweetLongText`
  - `tweets.searchByDate` → `TweetSearchByDatePageResult`
  - `followings.getFollowings` / `getFans` / `getMyFollowings` → `FollowingPageResult`；流产出 `UserBrief`
  - `favorites.getFavorites` 删除（raw 用 `fetchRawFavorites`）；`getTags` → `FavoriteTagList`
  - `trends.hotBand` → `TrendItem[]`
  - `users.myDetails` → `ISelfProfile`（raw 用 `fetchRawMyDetails`）
  - `search.searchUsers` / `searchTweets` → `SearchUserPageResult` / `SearchTweetPageResult`
  - `WeiboSessionContext.details` 改名为 `profile`
- 包根不再导出上游响应类型；需要 raw 时使用对应的 `fetchRaw*` 方法或 `config.hooks.onRaw`。
- 读取方法统一返回领域模型（`IUser` / `ITweet`）。
- 公开选项统一 camelCase，CLI 参数名保持原样。
- 包根只导出公开 API。
- **破坏性**：`IWeiboConfig.maxConcurrent` 改名为 `burst`，语义仍是令牌桶容量（突发上限），
  不是并发闸门；持续吞吐由 `delay` 决定。CLI `--burst` 不变。
- **破坏性**：`IWeiboConfig.delay` 只接受毫秒数；此前声明但从未生效的函数形式会在构造期抛
  `CONFIG_INVALID`，不再静默回退 1000ms。
- API 分层收紧：66 个只在文档里被顺带提及的导出（各方法的 `*Options` / `*Progress`、
  `Capability*` 枚举、`ArchivePhase` 等运行时标签与几个辅助常量）从 Stable 降为 Evolving。
  方法签名本身仍稳定；详见 `docs/engineering/api-stability.md`。
- API 分层再收紧：20 个实现细节（`*Options` / `*Progress*` / logger 选项 / `Credential*` /
  `PluginRequestInfo` / `TransportFailure*`）从 Stable 降为 Evolving；`check:api` 新增
  「Stable 保留模式」规则，这类形状默认不能升回 Stable。
- 分层命名：`Evolving` 取代原 `Experimental` 的语义（「可调用，但形状随 minor 演进」）；
  `Experimental` 改为预留档，只表示「可能被撤回的能力」（当前无条目）。
  `api-surface.json` 升到 `schemaVersion: 2`。
- **破坏性**：16 个实现细节不再从包根导出：`buildTweetContext`、`renderTweetContextMarkdown`、
  `normalizeTweet`、`normalizeComment`、`normalizeLiker`、`normalizeTweetUser`、`migrateTweetV1toV2`、
  `parseTweetIdInput`、`normalizeTweetIdInput`、`midToMblogId`、`diffSchemaDigest`、`formatSchemaDrift`、
  `TWEET_CONTEXT_SCHEMA`、`ParsedTweetId`、`TweetIdKind`、`SchemaDiffEntry`。
  这些是归一化 / id 解析 / 上下文渲染 / schema diff 的内部实现；需要时请改用公开方法或自行实现。
- 导出索引改为 `Stable` / `Evolving` 分区，`Evolving` 再按 shape（选项 / 进度 / 运行时标签 /
  扩展点 / 辅助函数）分组，不再把 100+ 个辅助类型平铺成一张「实验性」清单。
- **行为变更**：所有 Service 共享同一个令牌桶。此前每个 Service 各持一个桶，432 后的暂停只影响
  命中限流的那个服务，实际 QPS 是「服务数 × 1/delay」；现在暂停与平均速率对整实例生效。
- **破坏性**：`burst` 必须是 `>= 1` 的整数，`delay` 必须是 `>= 0` 的有限数（`0` 明确表示不限速）。
  非法值在构造期抛 `CONFIG_INVALID`；`burst: 0` 不再被静默改成 `3`。此前负数配置会让请求永久挂起。

### 修复

- `tweets.likers` / `streamLikers`：微博还没有人点赞时（上游返回 `{ ok: 0, msg: "还没有人赞过" }`，
  不带 `data`）改为返回空页并正常结束流，不再抛 `API_NOT_OK`。
- `tweets.streamByUserId`：整页都是广告时不再提前终止（`hasMore` 改为依据上游原始页）。
- `followings.streamFollowings` / `streamFans` / `streamMyFollowings`：使用上游 `hasMore` 提前结束，
  少发一次必然为空的请求。`FollowingPageResult.cursor` 是上游偏移量，不是页码。
- m 站关注 / 粉丝用户卡片改为经 `FollowingUserSchema` 校验，形状漂移时抛结构化错误而不是靠类型断言。
- CLI 归档的 7 处裸 `Error`（输出文件已存在 / 旧版 journal / meta 损坏或不兼容 / raw 路径冲突）
  改为结构化 `CONFIG_INVALID`，`formatCliError` 不再退化成 `code: 'UNKNOWN'`。
- 公开文档的 `session.details` 更正为 `session.profile`；`check:docs` 新增字段级漂移检查
  （`session.*` / `sdk.*` 必须是对应类型的公开成员）。

## 0.5.0 (2026-10-22)

- 修复自检失败被永久缓存：只有确定性失败会缓存，网络抖动后可以恢复。
- 响应类型改为 schema 推导，原始响应的未知字段继续保留。

## 0.4.0 (2026-10-22)

- 新增归档合并 `mergeArchiveFiles()` 与 `weibo-cli archive merge`。
- 新增 `ITweet.attachments`：文章、投票、直播、抽奖。
- 新增范围归档 `sdk.userArchive` / `weibo-cli archive user`，支持断点续跑。
- 新增结构化日志 `config.logger`。
- CLI 查询命令支持 `--format markdown`。

## 0.3.2 (2026-10-21)

- 新增可替换 transport 与插件系统。
- 归档支持页内并发预取。
- CLI 与 SDK 拆成独立构建产物，包根只暴露公开 API。

## 0.3.0 (2026-10-21)

- 新增访客模式：没有 Cookie 也能读取公开数据。
- 新增 `tweets.context` 与 `weibo-cli tweet context`。
- 修复跨账号归档把登录账号数据写入他人归档的问题。

## 0.2.0 (2026-10-20)

- 归档扩展到点赞、历史评论、收藏、图片墙、视频、通知和超话。
- 新增媒体下载。
- 新增流式评论、转发、关注 / 粉丝；所有流支持 `maxItems` / `maxPages`。
- 修复评论首屏只返回 3 条、首页 Feed 翻页等问题。

## 0.1.1 (2026-10-20)

- 修复安装问题，改用 `pnpm publish` 发布。

## 0.1.0 (2026-10-20)

- 首个公开版本：用户、时间线、微博、评论、归档与结构化错误。
