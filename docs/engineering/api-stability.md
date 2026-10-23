# 公开 API 稳定性政策

**状态**：生效中（2026-10-22，`0.6.0` 起）。**适用范围**：`@chilfish/weibo-sdk` 包根的导出面与 `WeiboSDK` 门面可达的公开方法。

> 公开文档的单一事实源是文档站（`website/`，部署在 `https://weibo-sdk.chilfish.top`）。本文只定义承诺与门禁，不重复方法签名。

## 1. 分层

| 层级 | 含义 | 变更规则 | 文档 |
|---|---|---|---|
| **Stable** | 下游可以依赖的契约 | 破坏性变更必须升包 major；0.x 内至少 `CHANGELOG` 迁移说明 | 必须在 `website/api/**` 有完整说明 |
| **Experimental** | 可用，但形状可能随上游漂移 | minor 内可改，需在 `CHANGELOG` 标注 | 在 `website/api/types/raw.md` 登记 |
| **Internal** | 仓库内部实现 | 不承诺，不导出 | 不写公开文档 |

凡包根导出且未归入任何一层的符号，`pnpm check:api` 直接失败——新增导出必须同时决定层级。

## 2. Stable 子集

### 门面与配置

`WeiboSDK` 全部公开成员、`IWeiboConfig`、`WeiboSDKHooks`、`WeiboSDKTelemetry`、`WeiboLogger`、`WeiboTransport` / `fetchTransport`、`WeiboPlugin`、`CredentialResolver`。

### 方法

所有公开读取方法返回归一化 camelCase 模型。

- `users`：`getById`、`myDetails`、`groups`、`mblogGroups`、`listMentions`、`streamMentions`。
- `tweets`：`getByMblogId`、`enrich`、`context`、`listByUserId`、`streamByUserId`、`listFriendTimeline`、`streamFriendTimeline`、`comments`、`replies`、`streamComments`、`streamReplies`、`getReposts`、`streamReposts`、`longText`、`searchByDate`、`likers`、`streamLikers`。
- `followings`：`getFollowings`、`getFans`、`getMyFollowings`、`streamFollowings`、`streamFans`、`streamMyFollowings`。
- `favorites`：`listFavorites`、`streamFavorites`、`getTags`。
- `likes`：`listByUserId`、`streamByUserId`。
- `commentHistory`：`listMine`、`streamMine`。
- `media`：`listImages`、`streamImages`、`listVideos`、`streamVideos`、`listAlbums`、`listAlbumPhotos`、`streamAlbumPhotos`、`downloadTweetMedia`、`downloadByMblogId`。
- `notifications`：全部 4 个方法。
- `topics`：`cates`、`list`、`stream`。
- `trends`：`hotBand`。
- `search`：`searchUsers`、`searchTweets`（`unavailable`，但返回形状稳定）。
- `archive`：`streamArchive`、`streamUsersArchive`。
- `userArchive`：`stream`、`run`。

### 类型

领域模型（`ITweet` 家族、`IUser` / `UserBrief` / `ISelfProfile`、`IUserMediaAsset` / `IUserAlbum`、`ITweetContext` 家族、`TweetLiker`、通知、`SuperTopic*`、`TrendItem`、`FavoriteTag` / `FavoriteTagList`、`UserGroup` / `MblogGroup`）、归档契约（`ArchiveFile`、`ArchivedTweet`、`ArchiveIssue`、`ArchiveItem`、`ArchiveCheckpoint`、`UserArchive*`）、能力清单类型、错误类与错误码、各方法的 `*Options` / `*PageResult` / `*Progress`（含 `FollowingPageResult`、`TweetCommentsPageResult`、`TweetRepostsPageResult`、`TweetLongText`、`TweetSearchByDatePageResult`、`SearchUserPageResult`、`SearchTweetPageResult`）。

### 冻结机制

- `ITweet` 继续用 `TWEET_CONTRACT_VERSION` 管理，规则见 [ITweet 契约](../../website/reference/tweet-contract.md)。
- 归档格式继续用 `weibo-user-archive/vN` 管理，规则见 [归档格式](../../website/reference/archive-format.md)。
- 其余 Stable 类型不做独立版本号，跟随包 SemVer。

## 3. Experimental 子集

- 返回原始上游形状的 `fetchRaw*` 方法：`users.fetchRawInfo` / `fetchRawDetails` / `fetchRawMyDetails`、`tweets.fetchRawUserTimelinePage` / `fetchRawComments` / `fetchRawReplies` / `fetchRawReposts` / `fetchRawLongText` / `fetchRawSearchByDate`、`followings.fetchRawFollowings` / `fetchRawFans` / `fetchRawMyFollowings`、`favorites.fetchRawFavorites` / `fetchRawTags`、`likes.fetchRawPage`、`commentHistory.fetchRawPage`、`media.fetchRawImagePage` / `fetchRawVideoPage`、`trends.fetchRawBand`、`search.fetchRawSearchUsers` / `fetchRawSearchTweets`。
- 辅助函数：`buildTweetContext`、`normalizeTweet`、`normalizeComment`、`normalizeLiker`、`migrateTweetV1toV2`、`diffSchemaDigest`、`formatSchemaDrift`、`parseTweetIdInput` / `normalizeTweetIdInput` / `midToMblogId`。

这些方法返回上游 snake_case 形状，字段随上游漂移；响应类型本身不从包根导出。

Experimental 不承诺字段稳定，但必须保持可调用并给出迁移说明。

## 4. Internal 子集

以下符号不从包根导出，也不出现在公开文档：

- 上游响应类型（`UserInfoResponse` / `BuildCommentsResponse` / `FriendshipsResponse` 等所有 `*Response`，以及 `*Item` / `MobileCard*` 等原始条目）。
- endpoint 参数类型（`*Args`）、服务依赖注入类型（`*Deps`）。
- `IResource` / `IResourceType`、`RawTweet`、`Tweet` / `User` 类。
- `PaginateOptions`、`PaginationPage`（`PaginationProgress` 因公共 `onProgress` 签名保留）。
- `isLogLevelEnabled`、`levelForEvent`、`redactLogRecord`、`toJsonlRecord`、`serializeTelemetryEvent`、`TelemetryRecord`。
- 视图管线 helper：`attachMediaDownloads`、`collectMediaOwners`、`normalizeTweetDate`、`cleanTweetText`、`TweetContextDownloadLike`、`BuildTweetContextOptions`。

需要仓库内使用时，从 `~/types/...`、`~/models/...` 直接导入，不走包根。

## 5. 变更流程

1. 新增公开导出：先决定层级，更新 `api-surface.json`，再写文档。
2. 修改 Stable 方法/类型：先改 `CHANGELOG`（含迁移写法），再改代码与文档。
3. 删除 Stable 导出：等同 breaking；0.x 内允许，但必须给迁移说明；1.0 后至少保留一个 major 的 `@deprecated` 再删除。
4. 0.x 阶段**不保留**兼容别名（沿用 0.3.2 起的做法）；1.0 后按上一条执行。
5. 每次 PR 必须让 `pnpm check:api` 与 `pnpm check:docs` 通过。

## 6. 门禁

| 门禁 | 内容 |
|---|---|
| `pnpm check:api` | 导出面快照、层级分类完整性、Stable/Experimental 文档覆盖率、service 方法覆盖率 |
| `pnpm check:docs` | `website/**` 不含内部路径、内部文档链接、postmortem/规划引用 |
| `pnpm schema:check` | 归档 JSON Schema 与类型定义一致 |
| `pnpm docs:build` | VitePress 构建与死链检查 |

`api-surface.json` 与 `api-surface.snapshot.json` 都是评审对象：前者表达承诺，后者记录实际导出面。
