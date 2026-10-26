# 公开 API 稳定性政策

**状态**：生效中（2026-10-23 修订，`0.6.0` 起）。**适用范围**：`@chilfish/weibo-sdk` 包根的导出面与 `WeiboSDK` 门面可达的公开方法。

> 公开文档的单一事实源是文档站（`website/`，部署在 `https://weibo-sdk.chilfish.top`）。本文只定义承诺与门禁，不重复方法签名。

## 1. 分层

| 层级 | 含义 | 变更规则 | 文档 |
|---|---|---|---|
| **Stable** | 下游可以依赖的契约 | 破坏性变更必须升包 major；0.x 内至少 `CHANGELOG` 迁移说明 | 必须在 `website/**` 的代码片段中有说明；`api/types/index.md`（生成页）不计入 |
| **Evolving** | 可用，但形状可能随 minor 演进 | minor 内可改，需在 `CHANGELOG` 标注 | 在 `api/types/index.md` 的 Evolving 分区按 shape 可见 |
| **Experimental** | 预留：可能被撤回的能力 | 不承诺，删除时给迁移说明 | 当前无条目 |
| **Internal** | 仓库内部实现 | 不承诺，不导出 | 不写公开文档 |

凡包根导出且未归入任何一层的符号，`pnpm check:api` 直接失败——新增导出必须同时决定层级。

**为什么把 Evolving 和 Experimental 分开**：这是两件不同的事。Evolving 回答「形状会不会变」（参数类型、进度事件、运行时标签随 minor 加字段），Experimental 回答「这个能力还存不存在」。逆向 SDK 的绝大多数辅助类型属于前者，把它们标成 Experimental 会让下游以为功能随时会被撤掉。当前 `Experimental` 没有条目，这个档位只为将来的能力预留。

层级不是主观贴标签：**Stable 的判据是「文档站有可被门禁验证的说明」，不是「我们打算不改」**。0.x 阶段 `check:api` 会把无法证明有说明的导出拒之门外；它们只能待在 Evolving。除此之外 §6 的 **Stable 保留模式** 还会把 `*Options` / `*Progress*` / `LogWriteStream` 这类「形状随 minor 演进」的辅助类型挡在 Stable 之外——要升 Stable 必须显式豁免并写明理由。

## 2. Stable 子集

### 门面与配置

`WeiboSDK` 全部公开成员、`IWeiboConfig`、`WeiboSDKHooks`、`WeiboSDKTelemetry`、`WeiboLogger`、`WeiboTransport` / `fetchTransport`、`WeiboPlugin`。

> 凭据解析是内部实现：`Credential` / `CredentialResolveContext` / `CredentialResolver` 在 0.x 内属于 Evolving，
> 它们的形状随访客 token 与 Cookie 解析策略演进，不构成下游依赖。

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

领域模型（`ITweet` 家族、`IUser` / `UserBrief` / `ISelfProfile`、`IUserMediaAsset` / `IUserAlbum`、`ITweetContext` 家族、`TweetLiker`、通知、`SuperTopic*`、`TrendItem`、`FavoriteTag` / `FavoriteTagList`、`UserGroup` / `MblogGroup`）、归档契约（`ArchiveFile`、`ArchivedTweet`、`ArchiveIssue`、`ArchiveItem`、`ArchiveCheckpoint`、`UserArchiveResult` / `UserArchiveRecord` / `UserArchiveSlice` / `UserArchiveSliceState` / `UserArchiveStore` / `UserArchiveMeta` / `UserArchiveSummary` / `UserArchiveRunConfig`）、错误类与错误码、各方法的 `*PageResult`。

> **Options / Progress / StreamLimit / 辅助常量不属于 Stable。**
> `*Options`、`*StreamOptions`、`*Progress`、`StreamLimitOptions`、`StreamRangeOptions`、`PaginationProgress`、`Capability*` 枚举、`ArchivePhase` / `ArchiveErrorAction` 等运行时标签，
> 以及 `WEIBO_CAPABILITIES` / `listCapabilities` / `formatArchiveProgress` / `isArchiveProgress`，
> 在 0.x 内默认 **Evolving**：方法签名本身稳定，但这些辅助形状可以随 minor 演进（会写进 `CHANGELOG`）。
> 这条不是口头约定：名字以 `*Options` / `*Progress*` / `*LoggerOptions` / `LogWriteStream` 结尾时，`pnpm check:api` 会拒绝它出现在 stable 层（详见 §6）。

### 冻结机制

- `ITweet` 继续用 `TWEET_CONTRACT_VERSION` 管理，规则见 [ITweet 契约](../../website/reference/tweet-contract.md)。
- 归档格式继续用 `weibo-user-archive/vN` 管理，规则见 [归档格式](../../website/reference/archive-format.md)。
- 其余 Stable 类型不做独立版本号，跟随包 SemVer。

## 3. Evolving 子集

### 方法

返回原始上游形状的 `fetchRaw*` 方法（19 个）：`users.fetchRawInfo` / `fetchRawDetails` / `fetchRawMyDetails`、`tweets.fetchRawUserTimelinePage` / `fetchRawComments` / `fetchRawReplies` / `fetchRawReposts` / `fetchRawLongText` / `fetchRawSearchByDate`、`followings.fetchRawFollowings` / `fetchRawFans` / `fetchRawMyFollowings`、`favorites.fetchRawFavorites` / `fetchRawTags`、`media.fetchRawImagePage` / `fetchRawVideoPage`、`trends.fetchRawBand`、`search.fetchRawSearchUsers` / `fetchRawSearchTweets`。

这些方法返回上游 snake_case 形状，字段随上游漂移；响应类型本身不从包根导出。它们必须登记在 `api-surface.json` 的 `methodTiers.evolving`，否则门禁失败。

> `likes.fetchRawPage` 与 `commentHistory.fetchRawPage` 标了 `@internal`，只供归档编排注入使用，不属于公开方法契约。

### 导出（按 shape 分组）

`api-surface.json` 的 `tiers.evolving` 共 86 个导出，`check:api` 按名字把它们归入五种 shape，生成页会按这个顺序展示：

| shape | 内容 |
|---|---|
| `options` | 各方法的 `*Options` / `*StreamOptions` / logger 选项 |
| `progress` | `*Progress` / `*ProgressEvent` / `*ProgressSummary` 与进度辅助函数 |
| `runtime` | `ArchivePhase` / `ArchiveErrorAction` / `Capability*` / `FollowingsSource` 等运行时标签 |
| `extension` | `Credential*` / `PluginRequestInfo` / `TransportFailure*` / `LogWriteStream` |
| `utility` | 仍保留在包根的辅助函数 |

shape 只是文档分组维度，不是额外承诺：它由 `shapeOf()` 从名字推导，新增命名不在规则内的导出会落到 `model`。

Evolving 不承诺字段稳定，但必须保持可调用并给出迁移说明。

## 4. Internal 子集

以下符号不从包根导出，也不出现在公开文档：

- 上游响应类型（`UserInfoResponse` / `BuildCommentsResponse` / `FriendshipsResponse` 等所有 `*Response`，以及 `*Item` / `MobileCard*` 等原始条目）。
- endpoint 参数类型（`*Args`）、服务依赖注入类型（`*Deps`）。
- `IResource` / `IResourceType`、`RawTweet`、`Tweet` / `User` 类。
- `PaginateOptions`、`PaginationPage`（`PaginationProgress` 因公共 `onProgress` 签名保留）。
- `isLogLevelEnabled`、`levelForEvent`、`redactLogRecord`、`toJsonlRecord`、`serializeTelemetryEvent`、`TelemetryRecord`。
- 视图管线 helper：`attachMediaDownloads`、`collectMediaOwners`、`normalizeTweetDate`、`cleanTweetText`、`TweetContextDownloadLike`、`BuildTweetContextOptions`。
- 归一化 / 解析 / 上下文渲染 helper（2026-10-23 从包根移除）：`normalizeTweet`、`normalizeComment`、`normalizeLiker`、`normalizeTweetUser`、`migrateTweetV1toV2`、`buildTweetContext`、`renderTweetContextMarkdown`、`TWEET_CONTEXT_SCHEMA`、`parseTweetIdInput`、`normalizeTweetIdInput`、`midToMblogId`、`ParsedTweetId`、`TweetIdKind`、`diffSchemaDigest`、`formatSchemaDrift`、`SchemaDiffEntry`。

需要仓库内使用时，从 `~/types/...`、`~/models/...`、`~/utils/...` 直接导入，不走包根。

## 5. 变更流程

1. 新增公开导出：先决定层级，更新 `api-surface.json`，再写文档。
2. 修改 Stable 方法/类型：先改 `CHANGELOG`（含迁移写法），再改代码与文档。
3. 删除 Stable 导出：等同 breaking；0.x 内允许，但必须给迁移说明；1.0 后至少保留一个 major 的 `@deprecated` 再删除。
4. 0.x 阶段**不保留**兼容别名（沿用 0.3.2 起的做法）；1.0 后按上一条执行。
5. 新增 `fetchRaw*` 方法：同时登记 `methodTiers.evolving`，否则 `pnpm check:api` 失败。
6. 每次 PR 必须让 `pnpm check:api` 与 `pnpm check:docs` 通过。

## 6. 门禁

| 门禁 | 内容 |
|---|---|
| `pnpm check:api` | 导出面快照、层级分类完整性、Stable 文档覆盖率（代码片段级别，生成索引页不计入）、**Stable 保留模式**、service 方法文档覆盖率、**方法层级** |
| `pnpm check:docs` | `website/**` + 根 `README.md` 不含内部路径、内部文档链接、postmortem/规划引用；且代码片段（fenced block / 行内 code）里的 `session.*` / `sdk.*` 必须是 `WeiboSessionContext` / `WeiboSDK` 的真实公开成员 |
| `pnpm schema:check` | 归档 JSON Schema 与类型定义一致 |
| `pnpm docs:build` | VitePress 构建与死链检查 |

### Stable 保留模式（防止 Stable 层悄悄长回来）

名字以 `*Options` / `*Progress` / `*ProgressSummary` / `*ProgressEvent` / `*LoggerOptions` / `LogWriteStream` 结尾的导出，
**不允许**出现在 `api-surface.json` 的 `tiers.stable`。规则实现在 `scripts/check-api-surface.ts`：

```ts
const STABLE_RESERVED_PATTERN = /(?:Options|Progress|ProgressSummary|ProgressEvent|LoggerOptions|LogWriteStream)$/
```

- 命中且不在 `api-surface.json` 的 `allowStablePatternExceptions`（默认空数组）里 → `pnpm check:api` 失败，并打印名字与豁免指引。
- 确需升 Stable（例如某个选项类型已冻结、下一 major 会带独立版本号）时，把名字加进 `allowStablePatternExceptions`，并在本节写一行理由。
- 豁免只能指向 `tiers.stable` 里已存在的名字；残留的旧豁免同样会让门禁失败，避免豁免表变成垃圾场。

### 方法层级（methodTiers）

`api-surface.json` 的 `methodTiers.evolving` 是方法级的显式清单，`check:api` 会：

- 遍历每个 Service 的公开方法（跳过 `private` / `protected` / `static` 与 JSDoc `@internal`）；
- 要求所有 `fetchRaw*` 方法都登记在 `methodTiers.evolving`，新增 raw 方法未登记直接失败；
- 要求清单里的名字仍然对应一个公开方法，删除方法后忘记清理同样失败。

未列出的公开方法默认 Stable，因此普通方法只需满足 `serviceDocs` 的文档覆盖要求，不强制逐项登记。

`docs/README.md` 的「约定」一节与本节描述的是同一套承诺：门禁只能证明「Stable 导出在文档站有代码片段说明」和「文档片段里的成员名真实存在」，
**不能证明语义等价**——散文与语义仍需人工评审。

`api-surface.json` 与 `api-surface.snapshot.json` 都是评审对象：前者表达承诺，后者记录实际导出面。
