# 微博 SDK 技术规格书

**版本**: 2.1.0
**状态**: 与实现对齐（docs-as-truth）
**最后更新**: 2026-08-09
**规范级别**: 类 RFC 2119

> 本文档描述 **当前实现** 的架构与契约（以代码为准）。标注「目标 / 未实现」的条目为演进方向，不代表现状。
> 若发现本文与代码不一致，以代码为准，并请同步修正本文（见 `CLAUDE.md`「文档即事实」）。

---

## 文档约定

关键词 "MUST"（必须）、"MUST NOT"（禁止）、"REQUIRED"（要求）、"SHOULD"（建议）、"OPTIONAL"（可选）按照 [RFC 2119](https://tools.ietf.org/html/rfc2119) 解释。

---

## 1. 架构概述

### 1.1 设计目标

`weibo-sdk` 是一个微博 API 逆向 TypeScript SDK，把微博页面/接口返回的"易变 raw JSON"稳定转换为"契约明确的领域模型"。

- **API 演化适应性**：上游字段频繁变动，SDK 通过 `EndpointSpec + Zod` 集中校验、`normalize` 纯函数兜底，最小化对下游消费者的影响。
- **可测试性**：默认 `pnpm test` 离线可跑（unit / component / fixture），E2E 用 `WEIBO_E2E=1` 显式开启。
- **开发者体验**：完整类型推导、结构化错误（`code/level/retryable/context`）、Wide Events 可观测性。
- **数据驱动**：所有 Schema / 归一化逻辑必须以真实微博 API 返回为准（`tests/fixtures/raw/`）。

### 1.2 分层架构

```
客户端层   WeiboSDK（门面） + CLI（citty）
服务层     UserService / TweetService / FollowingsService / FavoriteService / TrendsService / SearchService
基础设施层  FetcherService（HTTP + 错误映射 + 校验） / AuthService / RateLimitService / EndpointSpec + Zod
数据层     types/raw/**（原始响应类型） + types/domain/**（领域契约）+ models/data/**（归一化）
错误层     models/errors/**（结构化错误）
```

所有 Service 继承 `FetcherService`；`WeiboSDK` 聚合 6 个 Service 并以 `sdk.users` / `sdk.tweets` / `sdk.followings` / `sdk.favorites` / `sdk.trends` / `sdk.search` 暴露。

### 1.3 请求生命周期

`Service` 调用统一走 `FetcherService.request(spec, args)`：

```
request(spec, args)
 ├─ preflight（除非 skipPreflight）——selfCheck（lazy/eager）
 ├─ emit request_start（telemetry + hooks）
 ├─ rateLimitService.acquire()  ← 令牌桶，等待时 emit rate_limit_wait
 ├─ 注入请求头：referer / host / user-agent / Auth(cookie+xsrf)
 ├─ axios 请求
 │   └─ 失败 → mapError：ECONNABORTED/ETIMEDOUT → NET_TIMEOUT；其余 → NET_REQUEST_FAILED
 ├─ okPolicy 校验（require_ok_1）
 │   └─ ok !== 1 → API_NOT_OK（或 myDetails 的 AUTH_SESSION_EXPIRED）
 ├─ Zod safeParse
 │   └─ 失败 → API_BAD_RESPONSE（context.zodIssues）
 └─ emit request_success + hooks.onFetched
```

---

## 2. Entity Contracts

### 2.1 领域实体: IUser

`IUser` 是 SDK 向消费者暴露的用户领域实体（`models/data/User.ts` 归一化，`types/domain/IUser.ts` 契约）。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | `string` | REQUIRED | 用户唯一标识（数字字符串） |
| `name` | `string` | REQUIRED | 昵称 |
| `avatar` | `string` | REQUIRED | 头像 URL（`avatar_hd`/`avatar_large`） |
| `cover` | `string` | OPTIONAL | 封面 URL |
| `url` | `string` | REQUIRED | 个人主页 URL |
| `description` | `string` | OPTIONAL | 个人简介 |
| `birthday` / `realName` | `string` | OPTIONAL | 生日 / 真实姓名（归一化时去除「生日：」「姓名：」前缀） |
| `location` | `string` | OPTIONAL | 所在地（归一化时去除「IP属地：」前缀） |
| `gender` | `Gender` | REQUIRED | `'m' \| 'f' \| 'n'` |
| `createdAt` | `string` | OPTIONAL | 注册时间 |
| `verification` | `IUserVerification` | REQUIRED | `{ isVerified, type, reason? }` |
| `stats` | `{ followers, friends, statuses }` | REQUIRED | 粉丝/关注/微博数 |
| `company` / `school` / `creditLevel` / `externalLinks` | 各类型 | OPTIONAL | 详情扩展字段 |

**不变性**：
- `id` 非空；`stats.*` ≥ 0；`name` 非空。

### 2.2 领域实体: ITweet

`ITweet`（`models/data/Tweet.ts` 归一化，`types/domain/ITweet.ts` 契约）。`Tweet` 类是 `normalizeTweet(raw)` 的薄包装。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | `string` | REQUIRED | 微博 ID |
| `mblogId` | `string` | REQUIRED | 字母形式 ID（如 `QqsYymYOS`） |
| `createdAt` | `string` | REQUIRED | 发布时间 |
| `text` / `textHtml` | `string` | REQUIRED | 清洗后正文 / 原始 HTML |
| `regionName` | `string` | OPTIONAL | 属地 |
| `source` | `string` | REQUIRED | 发布来源 |
| `user` | `TweetUser` | REQUIRED | 发布者简版信息 |
| `stats` | `{ likes, comments, reposts }` | REQUIRED | 互动数 |
| `visible` | `TweetVisible` | REQUIRED | 可见性（0-4） |
| `retweetedStatus` | `ITweet` | OPTIONAL | 被转发原微博（递归） |
| `pageInfo` | `TweetPageCard` | OPTIONAL | 链接/视频卡片 |
| `media` | `TweetMedia[]` | REQUIRED | 媒体列表（图片/视频/LivePhoto/GIF） |
| `geo` | `TweetGeo` | OPTIONAL | 发博定位 |

**不变性**：`id`/`mblogId` 非空；`media` 为数组（可为空）；`stats.*` ≥ 0。

**媒体**（`TweetMedia`）：`id` / `type`（`pic|video|livephoto|gif|unknown`）/ `imageUrl` / `videoUrl?` / `duration?` / `width` / `height`。视频 URL 带签名与过期时间，一次性有效。

---

## 3. Interface Definitions

### 3.1 主入口: WeiboSDK

```typescript
class WeiboSDK {
  public readonly users: UserService
  public readonly tweets: TweetService
  public readonly followings: FollowingsService
  public readonly favorites: FavoriteService
  public readonly trends: TrendsService
  public readonly search: SearchService

  constructor(config: IWeiboConfig)          // cookie 为空抛 InvalidConfigError
  async selfCheck(): Promise<void>           // 配置 + 会话自检
  async checkSession(): Promise<boolean>     // 非抛错会话检查
}
```

### 3.2 配置: IWeiboConfig

```typescript
interface IWeiboConfig {
  cookie: string                              // REQUIRED
  xsrfToken?: string                          // 可选，X-XSRF-TOKEN
  proxyUrl?: string                           // 可选，axios proxy
  timeout?: number                            // 默认 30000ms
  logging?: boolean
  maxConcurrent?: number                      // 默认 3（令牌桶容量）
  delay?: number | ((retryCount: number) => number)   // 默认 1000ms
  hooks?: WeiboSDKHooks                       // onLifecycle / onFetched / onError
  telemetry?: WeiboSDKTelemetry               // Wide Events（扁平 KV）
  selfCheck?: { mode?: 'none' | 'lazy' | 'eager' }    // 默认 lazy
}
```

### 3.3 服务接口

**UserService**（`sdk.users`）

| 方法 | 签名 | 说明 |
|---|---|---|
| `info` | `(id: string) => Promise<UserInfoResponse>` | 用户信息 |
| `details` | `(id: string) => Promise<UserDetailsResponse>` | 用户详情 |
| `myDetails` | `() => Promise<UserDetailsResponse>` | 当前登录用户详情（无 uid，`skipPreflight`） |
| `getById` | `(id: string) => Promise<User>` | info + details 归一化为 `User` |

**TweetService**（`sdk.tweets`）

| 方法 | 签名 | 说明 |
|---|---|---|
| `myMblog` | `(uid, sinceId?, count?) => Promise<MyMblogResponse>` | 用户微博列表（raw） |
| `listByUserId` | `(uid, sinceId?) \| (uid, { sinceId?, count? }) => Promise<TweetPageResult>` | 归一化列表 + 广告过滤 + `hasMore` |
| `streamByUserId` | `(uid, options?) => AsyncIterableIterator<Tweet>` | 自动翻页流式 |
| `show` | `(mblogId, isGetLongText?) => Promise<StatusShowResponse>` | 微博详情（raw） |
| `getByMblogId` | `(mblogId, isGetLongText?) => Promise<Tweet>` | 归一化详情 |
| `comments` | `(mblogId, options?) => Promise<BuildCommentsResponse>` | 评论列表 |
| `longText` | `(mblogId) => Promise<LongtextResponse>` | 长微博全文 |
| `getReposts` | `(mblogId, { page?, count? }?) => Promise<RepostTimelineResponse>` | 转发列表 |
| `searchByDate` | `(uid, options?) => Promise<SearchProfileResponse>` | 日期范围搜索 |
| `friendTimeline` | `(options?) => Promise<FriendstimelineResponse>` | 首页 Feed（raw） |
| `listFriendTimeline` | `(options?) => Promise<TweetPageResult>` | 首页 Feed（归一化） |

> `TweetPageResult = { sinceId: string, hasMore: boolean, tweets: Tweet[] }`（`sinceId` 为 string，空串 = 无更多；分页回传该值作游标）。

**FollowingsService**（`sdk.followings`）：`getFollowings(uid, page?)`（关注）/ `getFans(uid, page?)`（粉丝，`relate=fans`）/ `getMyFollowings(page?)`——均返回 `FriendshipsResponse`
**FavoriteService**（`sdk.favorites`）：`getFavorites(uid, page?)` / `getTags()`（返回 `FavoritesTagsResponse`）
**TrendsService**（`sdk.trends`）：`hotBand(type?='hot')`（`'hot' | 'topic' | 'entertainment'`）
**SearchService**（`sdk.search`）：`searchUsers(query, page?)` / `searchTweets(query, page?)`

### 3.4 EndpointSpec

端点定义范式（`src/services/internal/EndpointSpec.ts` + `src/services/endpoints/**`）：

```typescript
interface EndpointSpec<TResource, TArgsSchema> {
  resourceType: TResource          // 资源类型（对应 IResource key）
  endpoint: string                 // 描述性端点名
  argsSchema?: TArgsSchema         // Zod args schema（args 类型自动推导）
  buildResource: (args) => IRequestResource   // 构建 URL + method
  okPolicy?: EndpointOkPolicy      // 'none' | 'require_ok_1'
  schema: ZodType<IResource[TResource]>        // response schema
}
```

- `IRequestResource = { method: 'GET'|'POST', url, headers? }`（`FetcherService.ts`）
- 用 `defineEndpoint(spec)` 包装以获得完整类型推导
- 反模式：禁止在 Service 文件中内联 Zod schema / EndpointSpec

### 3.5 资源类型

`IResource` 映射 16 个资源类型：`USER_INFO` / `USER_DETAILS` / `TWEET_MYMBLOG` / `TWEET_SHOW` / `TWEET_LONGTEXT` / `TWEET_SEARCHPROFILE` / `TWEET_COMMENTS` / `TWEET_FRIENDTIMELINE` / `TWEET_REPOST_TIMELINE` / `SIDE_BANDUNIFIED` / `FAVORITES_ALLFAV` / `FAVORITES_TAGS` / `SEARCH_USERS` / `SEARCH_TWEETS` / `FRIENDSHIPS_FRIENDS` / `PROFILE_FOLLOWCONTENT`。

端点实现清单见 `docs/planning/roadmap.md`。

### 3.6 Hooks 与 Telemetry

**Hooks**（`WeiboSDKHooks`）：`onLifecycle(event)` / `onFetched(resource, data, meta)` / `onError(error, meta)`。meta 含 `trace_id`、`timestamp`、`endpoint`、`request`、`args`、`phase`（`preflight|request|response|parse`）、`ok`、`message`。

**Telemetry**（`WeiboSDKTelemetry.emit(event)`）：Wide Events，扁平 KV，必含 `event_name/timestamp/trace_id`，其余字段 MUST 为 primitive。事件集：

- `sdk_init` / `self_check_start` / `self_check_ok` / `self_check_error`
- `request_start` / `request_success` / `request_error`
- `rate_limit_wait`
- `normalize_done`

`telemetry.emit()` 的任何异常 MUST NOT 影响 SDK 正常功能（外层 try/catch）。

### 3.7 公共导出面（src/index.ts）

`src/index.ts` 是包的唯一公共入口，导出：

- `VERSION`（包版本号）
- `WeiboSDK` 类（门面）
- 类型与枚举（`types/*`）：`IWeiboConfig`、`IUser`/`ITweet` 及其子类型、`IResource`、hooks/telemetry 类型、以及**所有 endpoint 响应类型**（`UserInfoResponse` / `UserDetailsResponse` / `MyMblogResponse` / `StatusShowResponse` / `LongtextResponse` / `SearchProfileResponse` / `BuildCommentsResponse` / `FriendstimelineResponse` / `SearchUsersResponse` / `SearchTweetsResponse` / `BandUnifiedResponse` / `FriendshipsResponse` / `FollowContentResponse` / `FavoritesResponse`）
- 领域模型：`User`、`Tweet`（类）、`normalizeTweet`（函数）、`RawTweet`（类型）
- 结构化错误类：`WeiboSDKError` 基类与全部 6 个子类（见 §4）

**规则**：
- 所有响应类型由 endpoint 的 Zod schema 推导（`z.infer`），消费者应使用导出的命名类型，而非手写接口。
- `types/raw/**` 中未被代码引用的历史接口（comment/band/search）为内部遗留，不对外导出；端点类型以 `services/endpoints/*.ts` 的 `z.infer` 为准。
- 禁止从包入口导出内部实现（`services/*`、`models/data` 内部 helper 等）。

---

## 4. 错误处理

### 4.1 错误层次

```
WeiboSDKError (abstract: code / level / retryable / context)
 ├─ TransportError   → NET_TIMEOUT / NET_REQUEST_FAILED      (transport, retryable)
 ├─ ProtocolError    → API_BAD_RESPONSE                      (protocol)
 └─ BusinessError    → API_NOT_OK / AUTH_SESSION_EXPIRED / CONFIG_INVALID  (business)
```

> 注：`level` 目前与类名解耦——`API_BAD_RESPONSE` 类继承 `ProtocolError`，`CONFIG_INVALID` 等继承 `BusinessError`，但 `level` 由各实例声明。禁止直接 `throw new Error('...')`，必须使用结构化错误。

### 4.2 错误映射表（实际 6 类）

| code | 类 | level | 可重试 | 触发条件 |
|------|----|-------|--------|----------|
| `CONFIG_INVALID` | `InvalidConfigError` | business | ❌ | 构造时 cookie 为空 |
| `AUTH_SESSION_EXPIRED` | `WeiboSessionExpiredError` | business | ❌ | `myDetails()`（自检）返回 ok≠1 |
| `API_NOT_OK` | `WeiboAPINotOkError` | business | ❌ | 其他端点 ok≠1 |
| `API_BAD_RESPONSE` | `UnexpectedAPIResponseError` | protocol | ❌ | Zod 校验失败（`context.zodIssues`） |
| `NET_TIMEOUT` | `ConnectionTimeoutError` | transport | ✅ | 超时（`ECONNABORTED`/`ETIMEDOUT`） |
| `NET_REQUEST_FAILED` | `NetworkRequestError` | transport | ✅ | 其他网络错误（含 4xx/5xx，`context.status`） |

错误映射链：axios error → `mapError` → TransportError；`ok≠1` → BusinessError；Zod fail → ProtocolError。错误分类详情与诊断流程见 `docs/engineering/error-diagnostics.md`。

---

## 5. 速率控制与并发

`RateLimitService` 基于令牌桶：

- 容量：`config.maxConcurrent`（默认 3）
- 补充速率：`config.delay`（默认 1000ms）
- 等待时发出 `rate_limit_wait` 事件（含 `wait_ms/refill_rate_ms/max_tokens/tokens`）
- 支持注入 `now()` / `sleep()`（FakeClock）以便离线测试
- 请求前在 `FetcherService.request()` 中 `acquire({ trace_id })`

---

## 6. 字段演化治理

- 所有 response schema 采用 `.passthrough()` 开放端点模式（保留未知字段），代码访问字段一律 `.optional()`。
- `normalize`（`models/data/*.ts` 纯函数）提供默认值与 fallback 链：如 `avatar` fallback、`IP属地：`/`姓名：`前缀剥离、数字越界兜底。
- Schema 精确化原则：先声明 Model 构造器实际访问的字段，其余保持宽松（`docs/planning/roadmap.md` Phase 2）。
- 新增/修改 Schema 前 MUST 先获取真实 API 响应存为 fixture（数据驱动开发，见 `CLAUDE.md`）。

---

## 7. 可测试性

| 类型 | 网络 | 数据 | 运行条件 |
|---|---|---|---|
| Unit | 无 | 硬编码 | `pnpm test` |
| Component | 无（fakeAxios） | mock | `pnpm test` |
| Fixture-based | 无 | 真实脱敏 fixture | `pnpm test` |
| E2E | 真实 | 真实 Cookie | `WEIBO_E2E=1` |

- 测试基座：`tests/testkit/fakeAxios.ts`（`createFakeAxios`）、`FakeClock`、`TelemetryCollector`。
- 每个功能 MUST 有对应测试；新增测试先写失败用例（Red → Green → Refactor）。
- 契约测试数据：`tests/fixtures/raw/`（脱敏规则见 `tests/fixtures/raw/INDEX.md`）。

---

## 8. 目录结构（现状）

```
src/
  index.ts                  # 公共导出（VERSION + types + WeiboSDK）
  WeiboSDK.ts               # 门面，6 个 Service
  cli.ts                    # CLI 入口（citty）
  cli/commands/*.ts         # user / tweet / follow / favorite / search
  types/
    config.ts hooks.ts telemetry.ts resources.ts index.ts
    domain/{IUser,ITweet}.ts
    raw/{user,tweet,side,search}/**   # 原始响应类型（z.infer 替代中）
  services/
    public/{User,Tweet,Followings,Favorite,Trends,Search}Service.ts
    internal/{FetcherService,AuthService,RateLimitService,EndpointSpec}.ts
    endpoints/{user,tweet,search,side,follow,favorite}.ts
  models/
    data/{User,Tweet}.ts    # 领域模型归一化（纯函数）
    errors/*.ts             # 结构化错误
tests/
  unit/ component/ e2e/ fixtures/raw/ testkit/
```

---

## 9. 附录

### 9.1 术语表

完整意见性术语表见 `docs/requirements/glossary.md`。核心术语：

| 术语 | 定义 |
|------|------|
| **SDD** | Spec-Driven Development，规格驱动开发 |
| **Wide Events** | 宽事件，扁平 KV（`event_name/timestamp/trace_id`）的可观测性事件 |
| **EndpointSpec** | 端点定义（resourceType + endpoint + argsSchema + buildResource + okPolicy + schema） |
| **Resource Type** | 资源类型（`IResource` 的 key），一端点一资源 |
| **Open-ended Schema** | 开放端点模式（`.passthrough()`），保留未知字段 |
| **Normalize** | 将 raw JSON 转换为领域模型的纯函数过程 |
| **Trace ID** | 单次请求/归一化全链路的追踪标识 |

### 9.2 相关文档

- `docs/README.md` — 文档中央索引
- `docs/planning/roadmap.md` — 路线图、fixture 清单、真实数据获取手册
- `docs/engineering/error-diagnostics.md` — 错误排障手册
- `docs/engineering/cli.md` — CLI 命令参考
- `docs/planning/architecture.md` — 架构决策记录（ADR）
- `CLAUDE.md` — 仓库级硬约束（文档即事实 / 数据驱动 / 测试策略）

**文档结束**
