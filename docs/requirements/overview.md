# 项目概览

## 这是什么

`weibo-sdk` 是一个面向开发者的微博 API 逆向开源 SDK：通过可维护的分层架构，把微博页面/接口返回的"易变 raw JSON"稳定地转换为"契约明确的领域模型"，并提供可组合的服务能力（用户/微博/关注/收藏/搜索/热搜等）。

项目目标是：**可维护、易理解、开发者体验好**，并且在上游字段/API 频繁变动时，依然能通过契约与测试提供稳定性。

## 架构（分层）

分层目标见 `docs/engineering/technical-spec.md`，核心思想是：

- **客户端层**：`WeiboSDK`（对外门面，聚合 11 个领域服务 + `ArchiveService`）
- **服务层**：`UserService` / `TweetService` / `FollowingsService` / `FavoriteService` / `LikeService` / `CommentHistoryService` / `MediaService` / `NotificationService` / `TopicService` / `TrendsService` / `SearchService`（按领域组织 API，均继承 `FetcherService`）
- **基础设施层**：`FetcherService`（HTTP 核心）、`AuthService`（认证）、`RateLimitService`（节流/并发）等
- **数据层**：`types/raw/**`（原始 schema）、`types/domain/**` + `models/data/**`（领域契约与归一化）
- **错误层**：`models/errors/**`，结构化错误（Transport / Protocol / Business）带 `code/level/retryable/context`

### Endpoint 管理模式

API endpoint 定义统一放在 `src/services/endpoints/<domain>.ts`，使用 `defineEndpoint()` 定义：

- `argsSchema`：Zod schema（args 类型从 schema 自动推导）
- `schema`：Zod response schema（开放端点模式，`.passthrough()`）
- `buildResource`：构建 `IRequestResource`（URL + referer）
- `okPolicy`：控制 `ok !== 1` 时的错误处理（`none` / `require_ok_1`）

Service 中只需 `this.request(spec, args)` 即可完成请求 → 校验 → hooks emission → telemetry 全流程。

当前已定义 **30+ 个 endpoint spec / resource type**（按 domain 分文件；完整清单见 `src/services/endpoints/`）：

| 文件 | EndpointSpec | 资源 |
|---|---|---|
| `endpoints/user.ts` | `userInfoSpec` / `userDetailsSpec` / `myDetailsSpec` | `USER_INFO` / `USER_DETAILS` |
| `endpoints/tweet.ts` | `myMblogSpec` / `statusShowSpec` / `longtextSpec` / `searchProfileSpec` / `buildCommentsSpec` / `friendstimelineSpec` / `repostTimelineSpec` | `TWEET_*` |
| `endpoints/search.ts` | `searchUsersSpec` / `searchTweetsSpec` | `SEARCH_USERS` / `SEARCH_TWEETS` |
| `endpoints/side.ts` | `bandUnifiedSpec` | `SIDE_BANDUNIFIED` |
| `endpoints/follow.ts` | `friendshipsSpec` / `followContentSpec` | `FRIENDSHIPS_FRIENDS` / `PROFILE_FOLLOWCONTENT` |
| `endpoints/favorite.ts` | `favoritesSpec` / `favoritesTagsSpec` | `FAVORITES_ALLFAV` / `FAVORITES_TAGS` |

### 服务能力速览

| 服务 | 门面属性 | 核心方法 |
|---|---|---|
| `UserService` | `sdk.users` | `info` / `details` / `myDetails` / `getById` |
| `TweetService` | `sdk.tweets` | `myMblog` / `listByUserId` / `streamByUserId` / `show` / `getByMblogId` / `comments` / `longText` / `searchByDate` / `friendTimeline` / `listFriendTimeline` / `streamFriendTimeline` |
| `FollowingsService` | `sdk.followings` | `getFollowings` / `getFans` / `getMyFollowings` / `streamFollowings` / `streamFans` |
| `FavoriteService` | `sdk.favorites` | `getFavorites` / `listFavorites` / `streamFavorites` / `getTags` |
| `LikeService` | `sdk.likes` | `listByUserId` / `streamByUserId` |
| `CommentHistoryService` | `sdk.commentHistory` | `listMine` / `streamMine` |
| `MediaService` | `sdk.media` | `listImages` / `streamImages` / `listAlbums` / `listAlbumPhotos` / `streamAlbumPhotos` / `listVideos` / `streamVideos` / `downloadTweetMedia` / `downloadByMblogId` |
| `NotificationService` | `sdk.notifications` | `listComments` / `streamComments` / `listLikes` / `streamLikes` |
| `TopicService` | `sdk.topics` | `cates` / `list` / `stream` |
| `TrendsService` | `sdk.trends` | `hotBand` |
| `SearchService` | `sdk.search` | `searchUsers` / `searchTweets` |
| `ArchiveService` | `sdk.archive` | `streamArchive` / `streamUsersArchive` |

## 可测试性与开发方式（TDD-first）

本项目要求 **默认测试离线可跑**：

- 单元测试：纯逻辑/模型/normalize（0 IO）
- 组件测试：对 HTTP/时间/睡眠等边界做 mock，覆盖 Fetcher/Auth/RateLimit 与 service 行为
- E2E：需要真实 Cookie + 真实网络的用例必须默认跳过，通过 `WEIBO_E2E=1` 显式开启

测试工具：`tests/testkit/fakeAxios.ts` 提供 `createFakeAxios(handler)` 可代替真实 axios；各测试可按需定义 `FakeClock` / `TelemetryCollector`。

**数据驱动开发**：所有 Zod schema / Model 归一化逻辑必须以真实微博 API 返回数据为准（`tests/fixtures/raw/` 存真实脱敏 fixture），禁止凭手写接口猜测 Schema。详见 `AGENTS.md`「数据驱动开发」。

开发流程：先写契约与失败测试（Red），再最小实现（Green），最后重构（Refactor）。详见 `docs/planning/roadmap.md` 与 `docs/archive/todo-archive-mvp.md`。

## 可观测性（Wide Events）

遵循 `docs/engineering/skill.md`：核心路径必须能输出"宽事件"（扁平 KV，含 `event_name/timestamp/trace_id` 及关键上下文），覆盖 Happy Path 与 Error Path，并可在测试中断言事件序列与字段完整性。

已落地的事件类型：

- `request_start` / `request_success` / `request_error`（HTTP 请求生命周期）
- `rate_limit_wait`（令牌桶等待）
- `normalize_done`（领域模型归一化完成）
- `sdk_init` / `self_check_start` / `self_check_ok` / `self_check_error`（生命周期与自检）

## 文档

文档中央索引见 `docs/README.md`。

## 快速开始

作为依赖使用：

```bash
pnpm add @chilfish/weibo-sdk
npx weibo-cli --help
```

本仓库开发：

- 安装：`pnpm install`
- 测试：`pnpm test`
- 构建：`pnpm run build`
- 类型检查：`pnpm run typecheck`

> 若需要运行真实微博请求，请在项目根目录 `.env` 中提供 `WEIBO_COOKIE`，并使用专门的 e2e 测试入口（默认不运行）。

## 后续规划

0.1.0 发布收口与 0.2.0 用户数据丰富度（点赞 / 历史评论 / 媒体集合 / 增量 / 批量 / 可靠性 / DX）见 [todo-post-0.1.0.md](../archive/todo-post-0.1.0.md)（已完成并归档）；端点开发流程见 [endpoint-authoring.md](../engineering/endpoint-authoring.md)。
