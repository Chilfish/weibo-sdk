# 项目概览

## 这是什么

`weibo-sdk` 是一个微博公开数据的 TypeScript SDK。它把微博页面和接口返回的原始 JSON 转成稳定的领域模型，提供用户、微博、评论、关注、收藏、媒体、通知和归档等能力。项目同时提供 `weibo-cli`，所有公开能力都能从命令行调用。

它的主要使用场景是个人数据归档：把一个账号的公开内容完整保存到本地，支持断点续传、增量同步和离线测试。

## 代码结构

项目分为四层：

- 门面层：`WeiboSDK` 负责装配配置、鉴权、限流、hooks 和遥测，并把领域服务暴露给调用方。
- 服务层：`UserService`、`TweetService`、`FollowingsService`、`FavoriteService`、`LikeService`、`CommentHistoryService`、`MediaService`、`NotificationService`、`TopicService`、`TrendsService`、`SearchService` 和 `ArchiveService`。除归档外，这些服务都继承 `FetcherService`。
- 基础设施层：`FetcherService` 处理 HTTP 请求，`AuthService` 管理 Cookie 和 XSRF，`RateLimitService` 负责令牌桶和限流暂停。
- 数据层：`services/endpoints` 定义响应 Zod schema，响应类型由 `z.infer` 推导；`types/domain` 和 `models/data` 定义领域模型与归一化函数，`models/errors` 定义结构化错误。

所有 Service 方法最终都走 `this.request(spec, args)`，由它完成请求、Zod 校验、hooks 和遥测。

## 端点管理

微博端点统一放在 `src/services/endpoints/<domain>.ts`，用 `defineEndpoint()` 定义：

```ts
export const mySpec = defineEndpoint({
  resourceType: 'MY_RESOURCE',
  endpoint: 'ajax/...',
  argsSchema: MyArgsSchema,
  buildResource: args => ({ url: '...' }),
  okPolicy: { mode: 'require_ok_1' },
  schema: MyResponseSchema,
})
```

- `argsSchema` 定义请求参数，参数类型由 `z.infer` 自动推导。
- `schema` 校验响应，默认使用 `.loose()`，只声明代码实际访问的字段。
- `buildResource` 负责 URL、method 和必要的 header。
- `okPolicy` 决定 `ok !== 1` 时是否抛错。

目前按 domain 拆成 `user`、`tweet`、`search`、`side`、`follow`、`favorite`、`like`、`comment`、`media`、`notification`、`topics` 等文件。完整的 endpoint 和 resource 列表可以在 `src/services/endpoints/` 和 `src/types/resources.ts` 中查看。

## 服务能力

| 服务 | 门面属性 | 主要方法 |
|---|---|---|
| `UserService` | `sdk.users` | `info` / `details` / `myDetails` / `getById` / `listMentions` / `streamMentions` / `groups` / `mblogGroups` |
| `TweetService` | `sdk.tweets` | `listByUserId` / `streamByUserId` / `getByMblogId` / `comments` / `streamComments` / `replies` / `getReposts` / `longText` / `searchByDate` / `listFriendTimeline` / `streamFriendTimeline` / `likers` |
| `FollowingsService` | `sdk.followings` | `getFollowings` / `getFans` / `getMyFollowings` / `streamFollowings` / `streamFans` |
| `FavoriteService` | `sdk.favorites` | `getFavorites` / `listFavorites` / `streamFavorites` / `getTags` |
| `LikeService` | `sdk.likes` | `listByUserId` / `streamByUserId` |
| `CommentHistoryService` | `sdk.commentHistory` | `listMine` / `streamMine` |
| `MediaService` | `sdk.media` | `listImages` / `streamImages` / `listAlbums` / `listAlbumPhotos` / `streamAlbumPhotos` / `listVideos` / `streamVideos` / `downloadByMblogId` |
| `NotificationService` | `sdk.notifications` | `listComments` / `streamComments` / `listLikes` / `streamLikes` |
| `TopicService` | `sdk.topics` | `cates` / `list` / `stream` |
| `TrendsService` | `sdk.trends` | `hotBand` |
| `SearchService` | `sdk.search` | `searchUsers` / `searchTweets`（微博公开搜索接口目前不可用） |
| `ArchiveService` | `sdk.archive` | `streamArchive` / `streamUsersArchive` |

## 数据与错误

领域模型定义在 `src/types/domain`，例如 `ITweet`、`IUser`、`ITweetComment` 和 `ArchiveItem`。原始响应到领域模型的转换都在 `src/models/data` 中，使用纯函数，便于单独测试。

`ITweet` 当前为 v2：同一契约版本内只增加可选字段，不重命名、不删除，也不改变已有字段的类型。具体规则见 [contract-itweet-v2.md](../engineering/contract-itweet-v2.md)。

错误统一继承 `WeiboSDKError`，带有 `code`、`level`、`retryable` 和 `context`。HTTP 错误、业务错误和协议错误分别由不同子类表示，处理方式见 [error-diagnostics.md](../engineering/error-diagnostics.md)。

## 测试

默认测试不访问网络：

- 单元测试覆盖纯函数、归一化、分页计算和参数解析。
- 组件测试通过 fake axios 驱动 Service，覆盖请求参数、分页停止、错误映射和遥测。
- E2E 测试需要真实 Cookie 和外网，默认跳过，只有 `WEIBO_E2E=1` 时才运行。

```bash
pnpm test
pnpm test:e2e
pnpm run validate:fixtures
```

所有 Zod schema 和归一化逻辑都以 `tests/fixtures/raw/` 里的真实脱敏响应为准。新增或修改 schema 前，先抓一份真实响应存成 fixture。

## 可观测性

请求、限流、重试、归一化和自检都会发出扁平的结构化事件，包含 `event_name`、`timestamp` 和 `trace_id`。可以接入 `config.telemetry.emit()`，也可以使用 `createJsonlTelemetry()` 写入 JSONL 文件。

事件覆盖成功和失败路径。遥测本身出错不会影响 SDK 的正常请求。

## 快速开始

```bash
pnpm add @chilfish/weibo-sdk
npx weibo-cli --help
```

在仓库内开发：

```bash
pnpm install
pnpm test
pnpm run build
pnpm run typecheck
```

需要访问真实微博时，在项目根目录 `.env` 中配置 `WEIBO_COOKIE`，然后运行 `pnpm test:e2e`。

## 相关文档

- [README](../../README.md)
- [CLI 参考](../engineering/cli.md)
- [端点开发指南](../engineering/endpoint-authoring.md)
- [错误排障手册](../engineering/error-diagnostics.md)
- [技术规格](../engineering/technical-spec.md)
- [开发路线图](../planning/roadmap.md)
