# 微博 SDK 技术规格书

**版本**: 2.3.0
**状态**: 与实现对齐（docs-as-truth）
**最后更新**: 2026-10-20
**规范级别**: 类 RFC 2119

> 本文档描述 **当前实现** 的架构与契约（以代码为准）。标注「目标 / 未实现」的条目为演进方向，不代表现状。
> 若发现本文与代码不一致，以代码为准，并请同步修正本文（见 `AGENTS.md`「文档即事实」）。

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
服务层     UserService / TweetService / FollowingsService / FavoriteService / LikeService / CommentHistoryService / MediaService / NotificationService / TopicService / TrendsService / SearchService
基础设施层  FetcherService（HTTP + 错误映射 + 校验） / AuthService / RateLimitService / EndpointSpec + Zod
数据层     types/raw/**（原始响应类型） + types/domain/**（领域契约）+ models/data/**（归一化）
错误层     models/errors/**（结构化错误）
```

所有 Service 继承 `FetcherService`；`WeiboSDK` 聚合 11 个领域服务 + `ArchiveService`，以
`sdk.users` / `sdk.tweets` / `sdk.followings` / `sdk.favorites` / `sdk.likes` / `sdk.commentHistory` /
`sdk.media` / `sdk.notifications` / `sdk.topics` / `sdk.trends` / `sdk.search` / `sdk.archive` 暴露。

### 1.3 请求生命周期

`Service` 调用统一走 `FetcherService.request(spec, args)`：

```
request(spec, args)
 ├─ resolveProvider(spec.auth ?? 'cookie')  ← guest 模式 + cookie-only 端点=直接 AUTH_SESSION_EXPIRED（不发请求）
 ├─ preflight（除非 skipPreflight）——selfCheck（lazy/eager），同时填充 session 上下文（uid / 详情）
 ├─ emit request_start（telemetry + hooks，带 auth_mode / guest_refresh_count）
 ├─ rateLimitService.acquire()  ← 令牌桶，等待时 emit rate_limit_wait（含 432 后的全局暂停）
 ├─ 注入请求头：referer / host / user-agent / Auth（cookie+xsrf 或 guest token）
 ├─ axios 请求（guest 模式关闭自动重定向，自行识别 302 登录页 / visitor 入口）
 │   └─ 失败 → mapError：429/432 → RATE_LIMITED；ECONNABORTED/ETIMEDOUT → NET_TIMEOUT；其余 → NET_REQUEST_FAILED
 ├─ 重试循环（config.retry，默认 2 次）：可重试错误 → 指数退避 + jitter（Retry-After 优先）→ emit request_retry → 重新 acquire
 │   └─ 432/429 命中即 `rateLimitService.pause(delay)`，暂停全局令牌桶
 ├─ guest 静默门控：guest 端点返回 `{}` → AUTH_SESSION_EXPIRED（context.authFailureReason = 'empty_object'）
 ├─ okPolicy 校验（require_ok_1）（不重试）
 │   └─ ok !== 1 → API_NOT_OK（或 myDetails 的 AUTH_SESSION_EXPIRED）
 ├─ Zod safeParse（不重试）
 │   └─ 失败 → API_BAD_RESPONSE（context.zodIssues）
 └─ emit request_success + hooks.onFetched
```

`request()` 外面还包了一层 guest 刷新循环：本次逻辑请求已捕获可归因于鉴权的失败（`redirect_to_login` / `visitor_entry` / `ok_minus_100` / `forbidden` / `empty_object` / `html`），且 `auth: 'guest'`、端点不是 `auth: 'none'`、`config.guest.autoRefresh !== false` 时，刷新一次访客 token 后重跑整个请求。**每个逻辑请求最多刷新一次**（`guest_refresh_count` 取 0/1），刷新失败保留旧 token 并抛出原始错误；432/429 不参与刷新判定。

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
| `svip` / `mbrank` | `number` | OPTIONAL | 微博会员等级（`svip` / `mbrank`） |
| `hometown` | `string` | OPTIONAL | 家乡（详情页 `hometown`） |
| `labelDesc` | `IUserLabel[]` | OPTIONAL | 用户标签（详情页 `label_desc[]`，含深浅色配色） |

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
| `repostChain` | `TweetRepostEntry[]` | OPTIONAL | 转发链分层（`text` 的 `//@` 由近到远；`index` 0 = 当前微博），每层聚合该层 reppic 配图 |
| `pageInfo` | `TweetPageCard` | OPTIONAL | 链接/视频卡片（含封面、副标题、对象 id） |
| `media` | `TweetMedia[]` | REQUIRED | 媒体列表（图片/视频/LivePhoto/GIF） |
| `geo` | `TweetGeo` | OPTIONAL | 发博定位 |
| `topics` | `string[]` | OPTIONAL | 话题（`topic_struct[].topic_title`，去重保序） |
| `linkCards` | `TweetLinkCard[]` | OPTIONAL | 链接 / 超话卡片（`url_struct[]`） |
| `readCount` | `number` | OPTIONAL | 阅读数（`reads_count`；仅部分端点 / 自己可见） |
| `editCount` | `number` | OPTIONAL | 编辑次数（`edit_count`） |
| `title` | `string` | OPTIONAL | 顶栏标题（`title.text`，如「公开」「仅自己可见」） |
| `permanentVideoUrl` | `string` | OPTIONAL | 视频永久播放页（`media_info.h5_url`） |
| `isOriginal` | `boolean` | OPTIONAL | 是否原创（无 `retweeted_status`） |
| `sourceUrl` | `string` | OPTIONAL | 网页永久链接（`https://weibo.com/<uid>/<mblogid>`） |
| `atUsers` | `TweetAtUser[]` | OPTIONAL | @ 用户（从 `text` HTML 锚点解析，`/n/` 或 `/u/`） |
| `playCount` | `number` | OPTIONAL | 视频播放量（仅 `online_users` 含「次观看」；直播在线人数不映射） |
| `isTop` | `boolean` | OPTIONAL | 是否置顶（`isTop === 1/true`） |
| `audio` | `TweetAudio[]` | OPTIONAL | 音频 / 播客（`page_info` / `mix_media_info`） |
| `comments` | `ITweetComment[]` | OPTIONAL | 评论（P1-6）；普通 `normalizeTweet` 不填充，仅 `streamArchive({ includeComments: true })` 挂载 |

**不变性**：`id`/`mblogId` 非空；`media` 为数组（可为空）；`stats.*` ≥ 0。

**媒体**（`TweetMedia`）：`id` / `type`（`pic|video|livephoto|gif|unknown`）/ `imageUrl` / `videoUrl?` / `duration?` / `width` / `height`。视频 URL 带签名与过期时间，一次性有效。`page_info.media_info` 形态的视频（视频瀑布 / 部分详情页）也会归一化进 `media`。

**链接卡片**（`TweetLinkCard`）：`title` / `url` / `shortUrl?` / `pageId?` / `objectType?` / `typePic?` / `longUrl?` / `oriUrl?` / `urlType?`。`url` 是点击目标（`h5_target_url → long_url → ori_url`），`longUrl` 是规范网页地址，`oriUrl` 可能是 `sinaweibo://` scheme。

**页面卡片**（`TweetPageCard`）：`pageId` / `pageTitle` / `pageUrl` / `pagePic` / `type` / `objectType` / `objectId?` / `subtitle?`。`pagePic` 的 `http://` 会统一升级为 `https://`；`subtitle` 对应上游 `content2`（如播放/点赞/弹幕统计）。

**@ 用户**（`TweetAtUser`）：`name` / `username?` / `url?`。

**音频**（`TweetAudio`）：`id` / `title` / `url` / `duration?` / `pageUrl?` / `authorName?` / `authorId?`。

### 2.3 领域实体: IUserMediaAsset（D4 / D5）

图片墙与视频瀑布共用的媒体资产模型（`models/data/Media.ts` 归一化，`types/domain/IUserMediaAsset.ts` 契约）。这是独立于 `ITweet` 的新模型。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | `string` | REQUIRED | 图片为 `pid`；视频优先 `mblogid`（脱敏后 `media_id`/`page_id` 会退化为占位符） |
| `type` | `MediaType` | REQUIRED | `pic` / `video` / `livephoto` / `gif` / `unknown` |
| `url` | `string` | REQUIRED | 主资源地址：图片由 `pid` 构造 CDN URL；视频为最优直链 |
| `coverUrl` | `string` | OPTIONAL | 视频封面 / 图片静态图 |
| `videoUrl` | `string` | OPTIONAL | LivePhoto 的 `.mov` / 视频直链 |
| `duration` / `width` / `height` | `number` | OPTIONAL | 视频时长与封面尺寸（上游未下发时缺省） |
| `createdAt` | `string` | OPTIONAL | 图片墙为 `YYYY-MM`（`timeline_year/month`）；视频为微博 `created_at` |
| `sourceTweetId` | `string` | OPTIONAL | 图片墙 `mid` / 视频微博 `idstr` |
| `sourceMblogId` | `string` | OPTIONAL | 视频微博的 `mblogid` |
| `permanentPageUrl` | `string` | OPTIONAL | 视频永久播放页（`media_info.h5_url`） |
| `objectId` | `string` | OPTIONAL | 图片墙 `object_id` |

**不变性**：`id` 非空（图片墙缺 `pid` 的破损条目会被服务层过滤）；`url` 可能为空串（上游未下发可用地址时）。媒体 URL 与 `TweetMedia` 一样是临时签名 URL。

---

## 3. Interface Definitions

### 3.1 主入口: WeiboSDK

```typescript
class WeiboSDK {
  public readonly users: UserService
  public readonly tweets: TweetService
  public readonly followings: FollowingsService
  public readonly favorites: FavoriteService
  public readonly likes: LikeService
  public readonly commentHistory: CommentHistoryService
  public readonly media: MediaService
  public readonly notifications: NotificationService
  public readonly topics: TopicService
  public readonly trends: TrendsService
  public readonly search: SearchService
  public readonly archive: ArchiveService

  constructor(config: IWeiboConfig)          // auth: 'cookie' 且无 Cookie 时抛 InvalidConfigError
  get authMode(): 'cookie' | 'guest'         // 构造时确定，不随 Cookie 失效改变
  async selfCheck(): Promise<void>           // 配置 + 会话自检
  async getSession(options?: { refresh?: boolean }): Promise<WeiboSessionContext>
  async getGuestTokenStatus(): Promise<GuestTokenStatus | undefined>
  async checkSession(options?: { refresh?: boolean }): Promise<boolean>
}
```

`getGuestTokenStatus()` 返回 `{ issuedAt, scope, source }`，**不含 token 明文**；guest 模式下若尚未发放会触发一次发放（single-flight）。

会话上下文（`getSession`）：

- `authMode` 为 `'cookie'` / `'guest'`，由构造时的模式决定；
- Cookie 模式：与 lazy / eager 自检**共享同一次** `ajax/profile/detail`，不会为取 uid 额外请求；`details` 为该响应；
- Guest 模式：不请求 `profile/detail`，只确保访客 token 可用，`uid` / `details` 缺省，`guestTokenIssuedAt` 为 token 发放时间（unix 毫秒）；
- 实例级 single-flight 缓存，并发调用共享 Promise；失败不缓存；
- `uid` 从 `data.verified_url` 的 `uid=` 解析（仅 Cookie 模式），缺失时为 `undefined`；
- `selfCheck: { mode: 'none' }` 时仍可用（首次调用主动探测一次）；
- `refresh: true` 才会重新探测。CLI 每个进程只会产生至多一次自检；长时间运行的消费方复用一个 SDK 实例即可，不要在高频循环里刷新。

`capabilities()` 的条目带 `accountScoped` 标记：收藏、历史评论、通知、@我、我的关注等只能读取登录账号自身；归档的 `includeFavorites` / `includeCommentHistory` 也按此规则守卫。每条还带 `auth`（`cookie` / `guest` / `none`）、`guestPagination`（`none` / `first_page` / `full`）与 `guestNote`，是判断访客身份可用范围的第一手依据。

### 3.2 配置: IWeiboConfig

```typescript
interface IWeiboConfig {
  cookie?: string                             // 可选：header 串或 Cookie 文件路径（仅 Node）；auth: 'cookie' 时必填
  auth?: 'auto' | 'cookie' | 'guest'          // 默认 'auto'
  guest?: {                                   // 访客身份配置，guest 模式 / 无 Cookie 时生效
    token?: string                            // 预置访客 Cookie（需含 SUB=）；提供后不触发放接口
    issuer?: 'mobile' | 'desktop' | 'auto'    // 默认 'mobile'
    autoRefresh?: boolean                     // 默认 true；每个请求最多刷新一次
  }
  xsrfToken?: string                          // 可选，X-XSRF-TOKEN
  proxyUrl?: string                           // 可选，axios proxy
  timeout?: number                            // 默认 30000ms
  logging?: boolean
  maxConcurrent?: number                      // 默认 3（令牌桶容量）
  delay?: number | ((retryCount: number) => number)   // 默认 1000ms
  retry?: {                                   // 请求级重试（P1 可靠性），全部可选
    retries?: number                          // 默认 2（不含首次请求；0 = 不重试；硬上限 10）
    baseDelayMs?: number                      // 默认 500（指数退避起点）
    maxDelayMs?: number                       // 默认 8000（单次延迟上限，也截断 Retry-After）
    retryOn?: ('rate_limit' | 'server_error' | 'timeout' | 'network_error')[]  // 默认全部
  }
  hooks?: WeiboSDKHooks                       // onLifecycle / onRaw / onFetched(deprecated) / onError
  telemetry?: WeiboSDKTelemetry               // Wide Events（扁平 KV）
  selfCheck?: { mode?: 'none' | 'lazy' | 'eager' }    // 默认 lazy
}
```

> **重试语义**（`src/services/internal/RetryPolicy.ts`）：只对可重试的结构化错误生效——`RATE_LIMITED`（432/429）、`NET_REQUEST_FAILED`（仅 5xx 或无 `status` 的连接类失败）、`NET_TIMEOUT`。其余 4xx、`API_NOT_OK`、`API_BAD_RESPONSE`、`CONFIG_INVALID`、`AUTH_SESSION_EXPIRED` 一律不重试。延迟 = `min(maxDelayMs, baseDelayMs * 2^(n-1))` × jitter(0.5~1.0)；上游 `Retry-After`（秒或 HTTP date）优先，且同样受 `maxDelayMs` 截断。每次退避发 `request_retry` 事件，终态失败才发 `request_error` 与 hooks `onError`。

> **Cookie 输入解析**（`src/utils/cookieInput.ts`）：`cookie` 支持 Cookie header 串、Netscape Cookie 文件路径（7 列 TSV，支持 `#HttpOnly_`，仅保留 `weibo.com` / `weibo.cn` / `sina.com.cn` 域名并跳过过期条目）、内容为 header 串的文本文件路径（可带 `Cookie:` 前缀、可多行）。`WeiboSDK` 构造时解析一次，`AuthService` 兜底；浏览器环境无 `node:fs`，路径退化为普通字符串。路径不存在 / 读取失败 / 文件内无可用 Cookie 时抛 `InvalidConfigError`（`CONFIG_INVALID`）。

#### 3.2.1 鉴权模式（`auth`）

鉴权模式在构造时解析一次（`src/services/internal/AuthProvider.ts` 的 `resolveAuthMode`），之后不再变化：

| 配置 | 有效模式 | 说明 |
|---|---|---|
| `cookie` + `auth` 缺省 / `'auto'` | `cookie` | 有 Cookie 就用 Cookie |
| 无 `cookie` + `auth` 缺省 / `'auto'` | `guest` | 自动使用访客身份 |
| 无 `cookie` + `auth: 'guest'` | `guest` | 同上 |
| `cookie` + `auth: 'guest'` | `guest` | 显式访客身份，Cookie 被忽略 |
| 无 `cookie` + `auth: 'cookie'` | — | 构造时抛 `CONFIG_INVALID`（`context.field = 'cookie'`） |

- `auth: 'auto'` **不会在 Cookie 失效后降级到 guest**。访客能读到的数据范围比登录态小，静默降级会让调用方在不知情的情况下拿到不完整的数据；Cookie 失效照常抛 `AUTH_SESSION_EXPIRED`，由调用方决定是否改用 guest。
- guest 模式要求运行环境有全局 `fetch`（Node 18+），没有时抛 `AUTH_SESSION_EXPIRED`（`context.reason = 'fetch_unavailable'`）。

#### 3.2.2 访客 token 生命周期（`GuestTokenService`）

- 来源：移动端 `visitor.passport.weibo.cn` 的 `genvisitor` → `visitor?a=incarnate` 拿到 `SUB` / `SUBP`，再拼成 `Cookie` 头（附 `WEIBOCN_FROM=1110003030`）。`issuer: 'desktop'` 改走 `passport.weibo.com/visitor/genvisitor2`（scope 仅 `pc`），`issuer: 'auto'` 先移动端后桌面端。
- 解析：响应体是 JSONP（`window.cb && cb({...})`），优先从 `Set-Cookie` 读 `SUB` / `SUBP`，缺失时退回 JSONP 的 `data.sub` / `data.subp`；两者都没有则抛 `AUTH_SESSION_EXPIRED`（`context.reason = 'guest_token_issue'`，带 `step`）。
- 缓存：token 按 SDK 实例缓存，并发请求共享同一次发放（single-flight）；刷新同样共享同一个 Promise。
- 刷新：**每个逻辑请求最多刷新一次**。可归因于鉴权的失败（302 到登录页 / visitor 入口、`ok: -100`、403 登录文案、guest 端点的静默 `{}`、HTML 登录页）触发刷新后重试一次；432/429 属于限流，直接抛 `RATE_LIMITED`，不刷新。刷新失败保留旧 token 并抛出原始错误。
- 配置：`guest.token` 预置时完全不触发放接口（但必须含 `SUB=`，否则 `CONFIG_INVALID`）；`guest.autoRefresh: false` 关闭自动刷新。
- 不写磁盘，也不进日志：telemetry 只记录 `source` / `scope` / `issuedAt` / `duration_ms` 等元信息，**永远不记录 token 明文**。

### 3.3 服务接口

> **生熟双 API 收窄（F2，2026-09-04）**：raw 响应方法仅作为归一化路径与编排层（`ArchiveService`）的数据源保留，公开面默认走归一化方法；raw 方法在 `.d.ts` 中带 `@deprecated`。无归一化对应的 raw 方法（`comments` / `longText` / `getReposts` / `searchByDate` / `getFavorites` / `getFollowings` 等）不标弃用。

**UserService**（`sdk.users`）

| 方法 | 签名 | 说明 |
|---|---|---|
| `info` | `(id: string) => Promise<UserInfoResponse>` | 用户信息（raw；**@deprecated**：用 `getById`） |
| `details` | `(id: string) => Promise<UserDetailsResponse>` | 用户详情（raw；**@deprecated**：用 `getById`） |
| `myDetails` | `() => Promise<UserDetailsResponse>` | 当前登录用户详情（无 uid，`skipPreflight`；会话自检原语，不标弃用） |
| `getById` | `(id: string) => Promise<User>` | info + details 归一化为 `User` |
| `listMentions` | `({ maxId?, page? }?) => Promise<UserMentionsPageResult>` | `@我的微博` 单页（`max_id` / `page` 等价；`since_id` 被忽略） |
| `streamMentions` | `({ maxId?, page?, maxPages?, maxItems?, since?, until?, onProgress? }?) => AsyncIterableIterator<Tweet>` | 游标翻页 + 跨页 `mblogid` 去重；`next_cursor === 0` / 空页 / 游标不前进 / 范围边界停止；时间倒序，支持日期早停 |
| `groups` | `() => Promise<UserGroup[]>` | `/ajax/feed/allGroups` 拍平（`groups[].group[]`），按 `gid` 去重 |
| `mblogGroups` | `() => Promise<MblogGroup[]>` | `/ajax/mblog/querygroup` 的 `data.join_groups` |

**TweetService**（`sdk.tweets`）

> 所有 `mblogId` 参数都接受 mblogId / 数字 mid / 微博状态 URL，入口统一经 `normalizeTweetIdInput`
> 归一化；`likers` / `streamLikers` 只收数字 mid，非数字输入会先用 `statuses/show` 解析一次。

| 方法 | 签名 | 说明 |
|---|---|---|
| `myMblog` | `(uid, page?, count?) => Promise<MyMblogResponse>` | 用户微博列表（raw，page 游标；**@deprecated**：用 `listByUserId` / `streamByUserId`） |
| `listByUserId` | `(uid, { page?, count? }?) => Promise<TweetPageResult>` | 归一化列表 + 广告过滤 + `hasMore` |
| `streamByUserId` | `(uid, { page?, count?, maxPages?, maxItems?, since?, until? }?) => AsyncIterableIterator<Tweet>` | 自动翻页流式；时间倒序，支持条数 / 日期边界 |
| `show` | `(mblogId, isGetLongText?) => Promise<StatusShowResponse>` | 微博详情（raw；**@deprecated**：用 `getByMblogId`） |
| `getByMblogId` | `(mblogId, isGetLongText?) => Promise<Tweet>` | 归一化详情 |
| `enrich` | `(mblogId, { isGetLongText?, includeLongText? }?) => Promise<TweetEnrichResult>` | raw 响应 + 归一化模型（+ 可选长微博全文），不改变 `ITweet` v1 |
| `comments` | `(mblogId, options?) => Promise<BuildCommentsResponse>` | 评论列表 |
| `longText` | `(mblogId) => Promise<LongtextResponse>` | 长微博全文 |
| `getReposts` | `(mblogId, { page?, count? }?) => Promise<RepostTimelineResponse>` | 转发列表 |
| `searchByDate` | `(uid, options?) => Promise<SearchProfileResponse>` | 日期范围搜索（`starttime` / `endtime` 接受 **unix 秒**或 `YYYY-MM-DD` / `YYYYMMDD`，字符串在请求前换算为秒，日期取本地时区） |
| `friendTimeline` | `(options?) => Promise<FriendstimelineResponse>` | 首页「最新微博」关注时间线（raw；**@deprecated**：用 `listFriendTimeline`） |
| `listFriendTimeline` | `({ max_id?, since_id?, list_id?, fid?, count?, refresh? }?) => Promise<TweetPageResult>` | 首页「最新微博」（归一化）；`max_id` 翻旧页，`since_id` 只做增量过滤 |
| `streamFriendTimeline` | `({ maxId?, sinceId?, listId?, fid?, refresh?, count?, maxPages?, maxItems?, since?, until?, onProgress? }?) => AsyncIterableIterator<Tweet>` | `max_id` 自动翻页 + 跨页 `mblogId` 去重；`sinceId` 只请求一页增量；支持条数 / 日期边界 |
| `likers` | `(mid, { page? }?) => Promise<TweetLikersPageResult>` | 微博点赞者单页（m 站 `api/attitudes/show`；数字 mid / mblogId / URL 均可，非数字会自动解析） |
| `streamLikers` | `(mid, { page?, maxPages?, maxItems?, onProgress? }?) => AsyncIterableIterator<TweetLiker>` | page 翻页 + 跨页用户 id 去重；空页 / 整页重复 / 达到 total 停止 |

> `TweetEnrichResult = { tweet: Tweet, raw: StatusShowResponse, longText?: string }`：`raw` 为 passthrough 的 `statuses/show` 原始响应，调用方自行落盘；`longText` 仅在 `includeLongText: true` 时请求。
> `TweetPageResult = { page?: number, maxId?: string, sinceId?: string, hasMore: boolean, total?: number, partial?: boolean, tweets: Tweet[] }`（`partial: true` 表示 guest 模式下的 m 站第一页，见 §3.3.2）。
> 分页游标按端点分：`mymblog`（`listByUserId`/`streamByUserId`）用 `page`（下一页页码；2026-08 曾弃用 `since_id`，2026-10-20 复测 `since_id` 与 `page` 均可用且等价，归一化仍以 `page` 为主）；
> `friendstimeline`（`listFriendTimeline`/`streamFriendTimeline`）用 `maxId` 翻旧页（响应 `max_id`；`0` = 到底），`since_id` 只做增量过滤；`total_number` 实测恒为 2000 上限值，不能当作剩余条数。`mymblog.data.since_id` 的 raw 类型为 `string | number`。

**FollowingsService**（`sdk.followings`）：`getFollowings(uid, page?)`（关注）/ `getFans(uid, page?)`（粉丝，`relate=fans`）/ `getMyFollowings(page?)`——均返回 `FriendshipsResponse`
**FavoriteService**（`sdk.favorites`）：

| 方法 | 签名 | 说明 |
|---|---|---|
| `getFavorites` | `(uid, page?) => Promise<FavoritesResponse>` | raw 收藏响应（`data.status` / `data.total_number`；`page < 1` 按未指定处理） |
| `listFavorites` | `(uid, { page?, tag? }?) => Promise<FavoritePageResult>` | 单页归一化 + 页内去重 + 客户端标签过滤 |
| `streamFavorites` | `(uid, { page?, tag?, maxPages?, maxItems?, onProgress? }?) => AsyncIterableIterator<Tweet>` | 自动翻页 + 跨页去重 + 标签过滤 |
| `getTags` | `() => Promise<FavoritesTagsResponse>` | 收藏夹标签清单 |

> `FavoritePageResult = { page: number, hasMore: boolean, total?: number, totalPages?: number, tweets: Tweet[] }`。
> `hasMore` 优先用顶层 `total_page`，缺失时退回 `total_number` 估算；流式路径另有「整页重复即停止」保护。
> `tag` 为**客户端过滤**：上游 `all_fav` 忽略 `tag_id` / `tag` 参数；匹配收藏项自带 `tags` 的 id / 名称。
> `page=0` 实测上游 HTTP 400，SDK 统一按第一页处理。

**LikeService**（`sdk.likes`）：

| 方法 | 签名 | 说明 |
|---|---|---|
| `listByUserId` | `(uid, { page? }?) => Promise<LikePageResult>` | 单页归一化 + 页内 `mblogid` 去重；`hasMore` = 本页去重后非空；guest 模式返回 m 站第一页（`partial: true`、`hasMore: false`、`page: 1`） |
| `streamByUserId` | `(uid, { page?, maxPages?, maxItems?, onProgress? }?) => AsyncIterableIterator<Tweet>` | 自动翻页 + 跨页去重；空页 / 整页重复 / `maxPages` 停止 |

> 端点 `GET /ajax/statuses/likelist?uid=&page=`：真实响应只有 `data.list`，**无 total / cursor / hasMore**；`page=0` 与 `page=1` 等价，越界页返回 200 + 空数组。旧的 `/ajax/statuses/likes` 已下线（200 + HTML 404 页）。

**CommentHistoryService**（`sdk.commentHistory`）：

| 方法 | 签名 | 说明 |
|---|---|---|
| `listMine` | `({ maxId?, page? }?) => Promise<CommentHistoryPageResult>` | 单页归一化 + 去重；`cursor = data.next_cursor`，`hasMore = cursor !== 0 && comments.length > 0` |
| `streamMine` | `({ maxId?, page?, maxPages?, maxItems?, since?, until?, onProgress? }?) => AsyncIterableIterator<ITweetComment>` | 游标翻页 + 跨页去重；`next_cursor === 0` / 空页 / 游标不前进 / 整页重复 / `maxPages` 停止；时间倒序，支持日期早停 |

> 端点 `GET /ajax/message/myCmt`：翻页用 `max_id=<上一页 data.next_cursor>`（`page` 等价，`cursor` 被忽略）；`next_cursor === 0` 表示到底。只读当前登录用户自己的历史评论，端点不接受 uid。
> `ITweetComment` 在 v1 内新增 optional `rootId` / `replyTo` / `floorNumber` / `totalReplies` / `liked` / `parentMblogId` / `pics`；不挂完整 `parentTweet`。
> `pics`（`TweetCommentPic[]`）来自上游 `url_struct[].pic_infos`（图片评论），按 `pic_id` 去重；URL 同为临时签名 URL。

**MediaService**（`sdk.media`）：
| 方法 | 签名 | 说明 |
|---|---|---|
| `listImages` | `(uid, { sinceId? }?) => Promise<ImageWallPageResult>` | 图片墙单页；`sinceId` 为上一页 `data.since_id`；过滤缺 `pid` 的破损条目 |
| `streamImages` | `(uid, { sinceId?, maxPages?, maxItems?, onProgress? }?) => AsyncIterableIterator<IUserMediaAsset>` | 图片墙自动翻页 + 跨页按 `pid` 去重 |
| `listVideos` | `(uid, { cursor? }?) => Promise<VideoWaterfallPageResult>` | 视频瀑布单页；`cursor` 为上一页 `data.next_cursor`；从 `page_info.media_info` 提取视频 |
| `streamVideos` | `(uid, { cursor?, maxPages?, maxItems?, onProgress? }?) => AsyncIterableIterator<IUserMediaAsset>` | 视频瀑布自动翻页 + 跨页按资产 id 去重 |
| `fetchRawImagePage` | `(uid, { sinceId? }?) => Promise<ImageWallResponse>` | 图片墙原始页（归档 `schemaDigest`） |
| `fetchRawVideoPage` | `(uid, { cursor? }?) => Promise<WaterfallResponse>` | 视频瀑布原始页（归档 `schemaDigest`） |
| `listAlbums` | `(uid) => Promise<AlbumListResult>` | 相册列表（`getImageWall?has_album=true` 的 `album_list`） |
| `listAlbumPhotos` / `streamAlbumPhotos` | `(containerId, { sinceId?, maxPages?, maxItems? }?)` | 相册照片（`getAlbumDetail`，`since_id` 游标） |
| `downloadTweetMedia` | `(tweet, options) => Promise<TweetMediaDownloadResult>` | 单条微博媒体下载（Node-only；失败聚合） |
| `downloadByMblogId` | `(mblogId, options) => Promise<TweetMediaDownloadResult>` | 先拉详情（不补长文）再下载 |

> 端点：`GET /ajax/profile/getImageWall?uid=&sinceid=`（首屏 `sinceid=0`，`sinceid=-1` 等同第一页）；`GET /ajax/profile/getWaterFallContent?uid=&cursor=`（首屏 `cursor=0`，**`cursor=-1` 会 HTTP 400**）。两者停止条件均为「空页 / 游标缺失 / 游标不前进 / `maxPages`」。
> 下载使用独立 CDN 客户端（不携带 Cookie，仅 Referer + host 白名单），与 API 令牌桶隔离；临时文件 + 原子 rename；403/404/410 单飞刷新一次。详见 [media-download.md](./media-download.md)。

**NotificationService**（`sdk.notifications`）：
| 方法 | 签名 | 说明 |
|---|---|---|
| `listComments` | `({ maxId?, page? }?) => Promise<CommentNotificationPageResult>` | 评论通知单页；每项 `{ comment, tweet }` |
| `streamComments` | `({ maxId?, page?, maxPages?, maxItems?, since?, until?, onProgress? }?) => AsyncIterableIterator<CommentNotification>` | 游标翻页 + 跨页评论 id 去重；按评论时间早停 |
| `listLikes` | `({ maxId?, page? }?) => Promise<LikeNotificationPageResult>` | 点赞通知单页；每项 `{ id, createdAt, attitude, source, user, tweet }` |
| `streamLikes` | `({ maxId?, page?, maxPages?, maxItems?, since?, until?, onProgress? }?) => AsyncIterableIterator<LikeNotification>` | 游标翻页 + 跨页通知 id 去重；按点赞时间早停 |

> 端点：`GET /ajax/message/cmt`（评论通知）与 `GET /ajax/message/attitudes`（点赞通知）。两者都用 `max_id=<上一页 data.next_cursor>` 翻页（`page` 等价，`cursor` 被忽略），`next_cursor === 0` 到底。被赞/被评论微博已删除时上游不返回 `status`，条目会被跳过。`/ajax/message/count` 与 `/ajax/message/likeNotice` 已失效（200 + HTML 404 页），因此不提供「未读数」。


**TopicService**（`sdk.topics`）：`cates()`（超话分类）/ `list({ sortId?, keyword?, page? })`（`count` 为总页数）/ `stream({ sortId?, keyword?, page?, maxPages?, onProgress? })`。

**TrendsService**（`sdk.trends`）：`hotBand(type?='hot')`（`'hot' | 'topic' | 'entertainment'`）
**SearchService**（`sdk.search`）：`searchUsers(query, page?)` / `searchTweets(query, page?)` — ⚠️ **known-issue + 产品暂缓（2026-08 / 2026-10-19）**：m.weibo.cn 公开关键词搜索接口已失效（返回登录页 HTML，weibo.com cookie 不适用），且官方搜索体验差、逆向收益低；调用会抛 `UnexpectedAPIResponseError`（`API_BAD_RESPONSE`）。**不要与个人主页内按日期搜索混淆**：`searchProfile`（`searchByDate`）仍可用，属于归档能力。

**ArchiveService**（`sdk.archive`）：单账号归档编排层（不直接发请求，注入子 Service）

| 方法 | 签名 | 说明 |
|---|---|---|
| `streamArchive` | `(uid, options?) => AsyncIterableIterator<ArchiveItem>` | timeline（mymblog + 可选 searchProfile 日期切片，内联 reposts）→ likes → comments → favorites → images → videos 一条可恢复流 |
| `streamUsersArchive` | `(uids, options?) => AsyncIterableIterator<{ uid, item }>` | 多账号串行归档；按 uid 读取 checkpoint / incremental，单用户失败可 `skip` |

- `ArchiveItem = { schemaVersion, source, mblogId?, tweet?, asset?, schemaDigest, checkpoint, comment? }`：`source` 为 `'timeline' | 'repost' | 'favorite' | 'like' | 'comment' | 'image' | 'video'`；`source: 'comment'` 时评论本体在 `comment`，`tweet` 为被评论微博；`source: 'image'` 时 `tweet` 缺省、资产在 `asset`；`source: 'video'` 同时有 `tweet` 与 `asset`。`schemaVersion` 为 `ITweet` 存档契约版本（当前 `1`，规则见 [contract-itweet-v1.md](./contract-itweet-v1.md)）；`schemaDigest` 为 raw 结构快照（A7，`stripVolatileKeys`）；`checkpoint` 为进度快照（A6）。
- `ArchiveStreamOptions`（0.2）：`includeImages` / `includeVideos`（默认 `false`，需注入媒体原始页依赖）；`incremental: { since?, stopAtMblogId?, skipPinned? }`（仅 timeline）；`originalOnly`（跳过转发并关闭内联转发）；`searchQuery`（日期切片 `q`）。
- `ArchiveStreamOptions.onRaw(raw, meta)`（P1-9）：每个原始项在归一化前触发，`meta = { uid, source, mblogId, page?, parentMblogId? }`；下游自行落盘 raw，`ArchiveItem` 不携带 raw（见 [contract-itweet-v1.md §4.1](./contract-itweet-v1.md)）。
- `ArchiveStreamOptions`（P1-5）：`timelineSource?: 'mymblog' | 'search'`（默认 `mymblog`）；`includeDateSlices?: boolean`（默认 `true`）；`since?: number`（unix 秒，默认 2009-08-14）；`until?: number`（unix 秒，默认当前时间）；`sliceWindow?: number`（初始自适应窗口秒数，默认 30 天）；`maxSliceItems?: number`（单片超过该条数就对半缩小窗口，默认 800）。
- `ArchiveStreamOptions`（P1-3/P1-4/P1-6）：`onProgress(progress)`（每页/每阶段一次，`ArchiveProgress = { uid, phase, processed, total?, remaining?, source?, page? }`）；`onItemError(error, context)` 返回 `'abort' | 'skip' | 'retry'`；`repostErrorPolicy` / `commentsErrorPolicy` / `likesErrorPolicy` / `commentHistoryErrorPolicy`（转发/评论默认 `skip`，点赞/历史评论默认 `abort`）；`maxRetries`（默认 1，仅 `retryable` 错误）/ `retryDelayMs`；`includeComments`（默认 `false`）、`commentCount`（默认 20）、`maxCommentPagesPerTweet`（默认不限）；`includeLikes` / `includeCommentHistory`（默认 `false`）。`onProgress` 与 telemetry 异常不影响归档。
- `ArchiveCheckpoint = { uid, phase, page?, lastTimelineMblogId?, favoritesPage?, likesPage?, imagesCursor?, videosCursor?, commentHistoryCursor?, sliceEnd?, slicePage?, sliceWindow?, lastMblogId? }`（0.2）：**不再携带 `visitedMblogIds`**。`page` 语义 = mymblog 阶段**当前页**；`lastTimelineMblogId` = 已完整处理的最后一条微博；`likesPage` / `imagesCursor` / `videosCursor` 为对应阶段游标；`commentHistoryCursor` = comments 阶段当前页使用的 `max_id`；`sliceEnd` / `slicePage` / `sliceWindow` 为日期切片游标；`lastMblogId` 仅为兼容旧 checkpoint（`phase === 'reposts'`）保留。
- 反向兼容：`timelineSource='mymblog'` 时若 `data.total` 证明已完整则不切片；否则从最旧一条微博之前继续日期切片。单片 `total` 超过 `maxSliceItems` 时对半缩小窗口，避免 `searchProfile` 大范围下 `total` 失真与分页窗口重置；空切片会自动放大窗口跨过长期空档。
- 评论（P1-6）：`includeComments: true` 时对 timeline / repost 项调用 `tweets.comments` 分页拉取（`max_id`），归一化为 `ITweetComment[]` 挂到 `tweet.comments`；favorite 项不拉取。评论失败按 `commentsErrorPolicy` 默认 `skip`，微博本体仍产出。
- **页内并发（2026-10-21）**：`concurrency?: number`（默认 3，范围 1–8）控制同一页内条目的独立子请求预取窗口（评论链 + 转发首页）；分页、产出顺序、`onRaw` 顺序与 checkpoint 语义不变，`1` 为完全串行。实际 HTTP 并发仍受令牌桶 / 432 全局暂停约束。
- 与请求级重试的分工（P1 可靠性）：`config.retry` 在 `FetcherService` 内先执行（同一次 HTTP 调用的退避重试）；归档级 `maxRetries` / `retryDelayMs` 只处理**编排层**失败（分页/单条），因此两者不会叠加成双倍重试风暴——归档层看到的是已耗尽请求级重试后的终态错误。
- **续跑语义（at-least-once，重要）**：checkpoint 是「最后一条**已完整处理**的项」，不是输出游标。中断后续跑会重跑当前项 / 当前页：
  - `timeline` / `likes` / `favorites` / `comments`：通常只重复边界 1 条；
  - `images` / `videos`：游标在整页产出后才写回 checkpoint，续跑会**重放整页**。
  下游必须按 `mblogId`（媒体项按 `asset.id`）做幂等去重，不能假设 NDJSON 无重复。这是「不丢数据」优先于「不重复」的取舍。
- **账号级数据源（2026-10-20）**：`includeFavorites`（`all_fav` 忽略 uid）与 `includeCommentHistory`（`myCmt` 无 uid）只能读取**登录账号自身**的数据。`streamArchive` / `streamUsersArchive` 会在首次迭代前解析登录 uid（`myDetails().data.verified_url`），目标 uid 不匹配时抛 `InvalidConfigError`（`CONFIG_INVALID`，context 含 `uid` / `sessionUid`），不会把登录账号的收藏 / 评论静默写进他人归档。`includeLikes` 走 `likelist?uid=`，实测按 uid 作用域返回，不做该守卫。CLI 批量模式（`--uid-file`）因此默认关闭收藏，需要 `--favorites` 显式开启。
- 判别标准：≤20 行代码 + 一条 `weibo-cli archive <uid>` 命令镜像单账号。

#### 3.3.1 流式范围控制（`StreamLimitOptions` / `StreamRangeOptions`）

所有 `stream*` 方法共用 `src/utils/streamRange.ts` 的判定：

- `maxItems?: number`：跨页去重后的产出上限；达到后**不再请求下一页**（`paginate` 同步支持）。
- `since?: number | string` / `until?: number | string`：仅用于**时间倒序**的流。`since` 是下界（遇到更早条目即停止翻页），`until` 是上界（更晚条目跳过但仍继续）；接受 `YYYY-MM-DD` / `YYYYMMDD` / unix 秒，日期字符串按运行环境本地时区取当天起止。非法日期抛 `InvalidConfigError`（`CONFIG_INVALID`）。
- 起始游标 / 页码仍是断点续传与增量入口：`page`（page 型）、`maxId` / `sinceId`（max_id 型）、`sinceId` / `cursor`（媒体游标）。`since` 与 `sinceId` 不是一回事：前者是日期边界，后者是微博 id 或媒体游标。
- 日期边界只加在时间单调的流上：`streamByUserId` / `streamFriendTimeline` / `streamReposts` / `streamMentions` / `streamMine` / `streamComments`（通知）/ `streamLikes`（通知）。其余流（评论热度序、点赞/收藏的条目时间与被收藏时间不一致、图片墙月级 `createdAt`）只提供 `maxItems`，避免静默丢数据。

```ts
for await (const tweet of sdk.tweets.streamFriendTimeline({
  maxId: lastSeenId,          // 断点续传
  since: '2026-09-01',        // 增量下界
  until: '2026-10-01',        // 上界
  maxItems: 200,              // 最多 200 条
  maxPages: 20,               // 请求预算兜底
})) {}
```

#### 3.3.2 访客模式（guest）的读取范围

Guest 模式复用同一套服务方法，按端点声明的 `auth` 决定能不能发请求。范围分三类：

- **访客可读，能力完整**：用户资料、单条微博详情、长文、评论（`max_id` 分页可用完整翻页）、转发列表（`page`）、点赞者、图片墙 / 视频瀑布 / 相册、超话、热搜、Feed 分组（`feed/allGroups`，`auth: 'none'`）。媒体下载本身不带 Cookie。
- **访客只能读第一页**：用户时间线（m 站容器 `107603<uid>`）、点赞（`230869<uid>`）、关注（`231051_-_followers_-_<uid>`）、粉丝（`231051_-_follows_-_<uid>`）。注意上游容器命名与直觉相反：`followers` 容器返回「关注」，`follows` 容器返回「粉丝」。服务层在这一路径上：
  - `tweets.listByUserId` / `likes.listByUserId` 返回 m 站第一页，`partial: true`、`hasMore: false`，**不带 `page`**（`total` 取 `cardlistInfo.total`，有就带上）；
  - `followings.getFollowings` / `getFans` 返回首页用户，`next_cursor: 0`；用户对象按 Cookie 路径 `friendships.users[]` 的字段形状归一化（补齐 `id` / `idstr` / `name`，`followers_count` / `friends_count` / `statuses_count` 转数字，保留 `followers_count_str` 等缩写原文，不透出 `user_token`）；
  - 对应的 `stream*` 只产出这一页就结束；
  - `page > 1` 一律抛 `CONFIG_INVALID`（`context.field = 'page'`、`guestPagination: 'first_page'`），因为匿名第二页会被重定向到登录页。
- **只接受 Cookie**：`mymblog` 用户时间线原始端点、首页关注时间线、个人主页日期检索（`searchProfile`）、点赞与关注 / 粉丝的网页端点（`likelist` / `friendships`，guest 下改走 m 站第一页）、`followContent`、收藏与收藏标签、通知、@ 我、历史评论、微博分组（`mblog/querygroup`）、归档。guest 模式调用这些能力会在发出请求**之前**失败，返回 `AUTH_SESSION_EXPIRED` 且 `context.requiredAuth = 'cookie'`。

补充约定：

- m 站微博对象没有 `mblogid`，SDK 用数字 `mid` 换算（`midToMblogId`，例如 `5039815108333719 → OgHLUyXYP`）；换算不出合法 id 的条目（广告位、占位卡、id 漂移）直接跳过。
- m 站容器内容为空时返回 `{ ok: 0, msg: '这里还没有内容', data: { cards: [] } }`（同类文案还有 `暂无数据` / `还没有人赞过`）。这是真实空结果，`mobileContainerSpec.okPolicy.isEmptyResult` 会放行并返回空页，不报 `API_NOT_OK`；`ok: -100` 或登录文案不受影响，仍走鉴权失败。
- m 站微博没有 `text_raw`，只有 `raw_text`（纯文本）和 HTML `text`。`normalizeTweet` 的正文优先级为 `text_raw → raw_text → 解码后的 text`，否则访客时间线/点赞会出现 `text: ''`。
- 归档（`archive.streamArchive` / `streamUsersArchive`）在 guest 模式下直接抛 `CONFIG_INVALID`，理由是匿名列表只有第一页，无法保证归档完整；单点能力（详情、评论、媒体）仍可使用。
- 公开关键词搜索（`search.searchUsers` / `searchTweets`）保持 `unavailable`，访客搜索暂缓，等产品结论。

### 3.4 EndpointSpec

端点定义范式（`src/services/internal/EndpointSpec.ts` + `src/services/endpoints/**`）：

```typescript
interface EndpointSpec<TResource, TArgsSchema> {
  resourceType: TResource          // 资源类型（对应 IResource key）
  endpoint: string                 // 描述性端点名
  argsSchema?: TArgsSchema         // Zod args schema（args 类型自动推导）
  buildResource: (args) => IRequestResource   // 构建 URL + method
  okPolicy?: EndpointOkPolicy      // 'none' | 'require_ok_1'（可带 isEmptyResult / notOkError）
  auth?: EndpointAuth              // 'cookie'（默认）| 'guest' | 'none'
  schema: ZodType<IResource[TResource]>        // response schema
}
```

- `IRequestResource = { method: 'GET'|'POST', url, headers? }`（`FetcherService.ts`）
- 用 `defineEndpoint(spec)` 包装以获得完整类型推导
- 反模式：禁止在 Service 文件中内联 Zod schema / EndpointSpec

`auth` 的语义（`EndpointAuth`）：

| 取值 | 含义 | guest 模式下的行为 |
|---|---|---|
| `cookie` | 默认值，必须登录 Cookie | 请求发出前抛 `AUTH_SESSION_EXPIRED`，`context.requiredAuth = 'cookie'` |
| `guest` | 访客 token 可用；Cookie 模式下仍优先用 Cookie | 注入访客 Cookie，鉴权失败按 §3.2.2 刷新一次 |
| `none` | 不需要任何凭证 | 不注入 Cookie，也不会为它发放 token |

默认值是 `cookie`，这样新增端点不会被意外放到 guest 通道里。只有实际用访客 token 验证过可读的端点才标 `guest`；账号级数据（收藏、通知、@ 我、历史评论、我的关注）和「返回 `{}` / 空列表但看起来成功」的端点不要标 `guest`。

### 3.5 资源类型

`IResource` 映射 30 个资源类型：`USER_INFO` / `USER_DETAILS` / `TWEET_MYMBLOG` / `TWEET_SHOW` / `TWEET_LONGTEXT` / `TWEET_SEARCHPROFILE` / `TWEET_COMMENTS` / `TWEET_FRIENDTIMELINE` / `TWEET_REPOST_TIMELINE` / `SIDE_BANDUNIFIED` / `FAVORITES_ALLFAV` / `FAVORITES_TAGS` / `LIKES_LIST` / `COMMENTS_MINE` / `PROFILE_IMAGE_WALL` / `PROFILE_WATERFALL` / `PROFILE_ALBUM_DETAIL` / `TWEET_LIKERS` / `FEED_GROUPS` / `MBLOG_GROUPS` / `MENTIONS_STATUSES` / `MESSAGE_COMMENTS` / `MESSAGE_ATTITUDES` / `SEARCH_USERS` / `SEARCH_TWEETS` / `MOBILE_CONTAINER` / `FRIENDSHIPS_FRIENDS` / `PROFILE_FOLLOWCONTENT` / `STOPIC_CATES` / `STOPIC_LIST`。`MOBILE_CONTAINER` 是 guest 第一页读取（用户时间线 / 点赞 / 关注 / 粉丝）共用的 m 站容器响应。

端点实现清单见 `docs/planning/roadmap.md`。

### 3.6 Hooks 与 Telemetry

**Hooks**（`WeiboSDKHooks`）：`onLifecycle(event)` / `onRaw(raw, meta)` / `onFetched(resource, data, meta)`（**@deprecated**，用 `onRaw` + telemetry）/ `onError(error, meta)`。`onRaw` 在 Zod 校验前触发（raw 为端点原始响应，未校验），meta 含 `trace_id`、`timestamp`、`endpoint`、`resourceType`、`request`、`args`。其余 hook meta 含 `phase`（`preflight|request|response|parse`）、`ok`、`message`。

**Telemetry**（`WeiboSDKTelemetry.emit(event)`）：Wide Events，扁平 KV，必含 `event_name/timestamp/trace_id`，其余字段 MUST 为 primitive。事件集：

- `sdk_init` / `self_check_start` / `self_check_ok` / `self_check_error`
- `request_start` / `request_success` / `request_error`（`attempt?` = 第几次尝试）/ `request_retry`（P1 可靠性：`attempt / max_attempts / delay_ms / reason / status? / error_*`）
- `rate_limit_wait`（`wait_ms / refill_rate_ms / max_tokens / tokens / reason?`，`reason` = `token_refill` 补充令牌 | `rate_limited` 432 后的全局暂停）
- `normalize_done`
- `archive_progress`（P1-3）：`uid / phase / processed / total? / remaining? / source? / page?`
- `archive_item_error`（P1-4）：`uid / phase / stage / source? / mblogId? / parentMblogId? / page? / action / error_*`
- `guest_token_issue` / `guest_token_error`（由 `GuestTokenService` 发出）：`source / scope / duration_ms / refreshed`，失败时带 `issuer / error_*`，**不含 token 明文**

所有请求级事件（`request_start` / `request_success` / `request_error` / `request_retry`）都带 `auth_mode`（`cookie` / `guest`）与 `guest_refresh_count`（0/1）；`request_error` 还带 `auth_failure_reason`，取值为 `redirect_to_login` / `visitor_entry` / `ok_minus_100` / `forbidden` / `empty_object` / `html` 之一，可直接用于判断「是鉴权问题还是接口问题」。

`telemetry.emit()` 的任何异常 MUST NOT 影响 SDK 正常功能（外层 try/catch）。

### 3.7 公共导出面（src/index.ts）

`src/index.ts` 是包的唯一公共入口，导出：

- `VERSION`（包版本号）
- `WeiboSDK` 类（门面）
- 类型与枚举（`types/*`）：`IWeiboConfig`、`IUser`/`ITweet`/`IUserMediaAsset`/`UserGroup`/`MblogGroup`/`TweetLiker`/`CommentNotification`/`LikeNotification` 及其子类型、`IResource`、hooks/telemetry 类型（含 `WeiboSDKRawMeta`）、raw/enrich 类型（`ArchiveRawMeta` / `TweetEnrichOptions` / `TweetEnrichResult`）、以及**所有 endpoint 响应类型**（`UserInfoResponse` / `UserDetailsResponse` / `MyMblogResponse` / `StatusShowResponse` / `LongtextResponse` / `SearchProfileResponse` / `BuildCommentsResponse` / `FriendstimelineResponse` / `SearchUsersResponse` / `SearchTweetsResponse` / `BandUnifiedResponse` / `FriendshipsResponse` / `FollowContentResponse` / `FavoritesResponse` / `FavoritesTagsResponse` / `LikeListResponse` / `MyCommentsResponse` / `ImageWallResponse` / `WaterfallResponse` / `LikersResponse` / `MentionsViewResponse` / `MessageCommentsResponse` / `MessageAttitudesResponse` / `FeedGroupsResponse` / `MblogGroupsResponse`）
- 领域模型：`User`、`Tweet`（类）、`SuperTopic` / `SuperTopicCategory`、`normalizeTweet` / `normalizeComment` / `normalizeLiker` / `normalizeCommentNotification` / `normalizeLikeNotification` / `normalizeUserGroups` / `normalizeMblogGroups` / `normalizeImageWallItem` / `normalizeWaterfallVideo` / `normalizeAlbum` / `normalizeSuperTopic`（函数）、`RawTweet` / `IUserMediaAsset` / `IUserAlbum`（类型）
- 归档类型：`ArchiveItem` / `ArchiveCheckpoint` / `ArchiveStreamOptions` / `ArchiveIncrementalOptions` / `ArchiveUsersOptions` / `ArchiveUserItem` / `ArchiveProgress` / `ArchiveItemErrorContext` / `ArchiveRawMeta`
- 能力清单：`WEIBO_CAPABILITIES` / `listCapabilities()` / `WeiboSDK.capabilities()`
- 工具：`paginate()`（统一分页停止语义）、`diffSchemaDigest()` / `formatSchemaDrift()`、`parseArchiveState()` / `updateArchiveState()` / `incrementalOptionsFromState()`
- Telemetry JSONL 消费端（P2-3）：`createJsonlTelemetry` / `serializeTelemetryEvent` / `formatArchiveProgress` / `isArchiveProgress`
- 结构化错误类：`WeiboSDKError` 基类与全部 7 个子类（见 §4）

**构建产物**（P2-1）：Node 入口 `@chilfish/weibo-sdk` → `dist/index.mjs`；CLI 二进制 `weibo-cli` → `dist/cli.mjs`；浏览器/userscript 入口 `@chilfish/weibo-sdk/browser` → `dist/browser.mjs`（platform browser，axios/zod 内联，类型复用 `dist/index.d.mts`）。浏览器运行时 `proxyUrl` 不注入 axios `proxy`（由浏览器/宿主决定代理）。

**规则**：
- 所有响应类型由 endpoint 的 Zod schema 推导（`z.infer`），消费者应使用导出的命名类型，而非手写接口。
- `types/raw/**` 中未被代码引用的历史接口（comment/band/search）为内部遗留，不对外导出；端点类型以 `services/endpoints/*.ts` 的 `z.infer` 为准。
- 禁止从包入口导出内部实现（`services/*`、`models/data` 内部 helper 等）。

---

## 4. 错误处理

### 4.1 错误层次

```
WeiboSDKError (abstract: code / level / retryable / context)
 ├─ TransportError   → NET_TIMEOUT / NET_REQUEST_FAILED / RATE_LIMITED  (transport, retryable)
 ├─ ProtocolError    → API_BAD_RESPONSE                                (protocol)
 └─ BusinessError    → API_NOT_OK / AUTH_SESSION_EXPIRED / CONFIG_INVALID  (business)
```

> 注：`level` 目前与类名解耦——`API_BAD_RESPONSE` 类继承 `ProtocolError`，`CONFIG_INVALID` 等继承 `BusinessError`，但 `level` 由各实例声明。禁止直接 `throw new Error('...')`，必须使用结构化错误。
> `RATE_LIMITED` 归类为 **transport**：由 HTTP 状态码直接判定，与其余传输层错误同处「可重试」组（`retryable: true`）；与业务语义失败（`ok !== 1`）区分开，便于下游按「退避重试」而非「改参数/换 Cookie」处置。

### 4.2 错误映射表（实际 10 类）

| code | 类 | level | 可重试 | 触发条件 |
|------|----|-------|--------|----------|
| `CONFIG_INVALID` | `InvalidConfigError` | business | ❌ | 构造时 Cookie 为空（显式 `auth: 'cookie'`）、Cookie 文件不可用、guest 预置 token 缺 `SUB=`、guest 下请求第 2 页、guest 下调用归档 |
| `AUTH_SESSION_EXPIRED` | `WeiboSessionExpiredError` | business | ❌ | `myDetails()`（自检）返回 ok≠1；guest 下 cookie-only 端点（`context.requiredAuth = 'cookie'`）、访客 token 发放失败、guest 端点返回静默 `{}` |
| `API_NOT_OK` | `WeiboAPINotOkError` | business | ❌ | 其他端点 ok≠1 |
| `API_BAD_RESPONSE` | `UnexpectedAPIResponseError` | protocol | ❌ | Zod 校验失败（`context.zodIssues`） |
| `NET_TIMEOUT` | `ConnectionTimeoutError` | transport | ✅ | 超时（`ECONNABORTED`/`ETIMEDOUT`） |
| `NET_REQUEST_FAILED` | `NetworkRequestError` | transport | ✅ | 其他网络错误（含 4xx/5xx，`context.status`） |
| `RATE_LIMITED` | `RateLimitError` | transport | ✅ | HTTP 432（微博风控）/ 429；`context` = `status` / `retryAfterMs?` / `attempt` / `message?` |
| `MEDIA_DOWNLOAD_FAILED` | `MediaDownloadError` | transport | ✅ | 媒体 CDN 5xx/429/408/超时/连接/空闲超时/截断/0 字节 |
| `MEDIA_BAD_RESPONSE` | `MediaInvalidResponseError` | protocol | ❌ | HTML/JSON、类型族不符、超上限、非法重定向 |
| `MEDIA_STORAGE_FAILED` | `MediaStorageError` | storage | ❌ | mkdir/write/rename/unlink 失败 |

错误映射链：axios error → `mapError` → TransportError（429/432 优先映射为 `RATE_LIMITED`）；`ok≠1` → BusinessError；Zod fail → ProtocolError。可重试错误由 `FetcherService` 的重试循环消费（见 §5）。错误分类详情与诊断流程见 `docs/engineering/error-diagnostics.md`。

Guest 模式额外写入的 `context` 字段（便于区分「该换 Cookie」还是「访客读不到」）：

- `auth_mode: 'guest'`：所有 guest 路径的鉴权错误都会带；
- `requiredAuth: 'cookie'`：cookie-only 端点在 guest 模式下被拒（`field` 可能同时给出 `endpoint`）；
- `authFailureReason`：`redirect_to_login` / `visitor_entry` / `ok_minus_100` / `forbidden` / `empty_object` / `html`，决定是否触发刷新；
- `reason: 'guest_token_issue'`（带 `step` / `status`）或 `reason: 'fetch_unavailable'`：访客 token 发放失败；
- `guestPagination: 'first_page'`：guest 下请求了第 2 页（`field: 'page'`）；
- `field: 'archive'`：guest 下调用了归档。

---

## 5. 速率控制、重试与并发

`RateLimitService` 基于令牌桶：

- 容量：`config.maxConcurrent`（默认 3）
- 补充速率：`config.delay`（默认 1000ms）
- 等待时发出 `rate_limit_wait` 事件（含 `wait_ms/refill_rate_ms/max_tokens/tokens/reason`）
- 支持注入 `now()` / `sleep()`（FakeClock）以便离线测试
- 请求前在 `FetcherService.request()` 中 `acquire({ trace_id })`
- **全局暂停**（P1 可靠性）：`pause(ms, { trace_id, reason })` 把令牌桶冻结到 `now + ms`（多次暂停取最晚截止时间）；`acquire()` 的 `while` 循环会先等待暂停结束再取令牌。432/429 命中后由 `FetcherService` 调用，避免并发请求同时撞墙；暂停期内的等待以 `rate_limit_wait.reason = 'rate_limited'` 记录。

**重试与限流的协作**（`RetryPolicy` + `FetcherService`）：

- 重试循环用 `for`（非递归），每次尝试都重新 `acquire()`，因此暂停对重试同样生效。
- 延迟算法：`min(maxDelayMs, baseDelayMs * 2^(attempt-1))` × jitter（0.5~1.0）；上游 `Retry-After`（秒 / HTTP date）优先且受 `maxDelayMs` 截断。
- 幂等性：当前所有端点均为 `GET` 只读请求，重试安全；若未来引入写端点，必须先在 `retryOn` 中显式排除或新增 method 白名单。
- `retries` 归一化到 `[0, 10]`，避免 `Infinity` 造成无限重试。

---

## 6. 字段演化治理

- 所有 response schema 采用 `.passthrough()` 开放端点模式（保留未知字段），代码访问字段一律 `.optional()`。
- `normalize`（`models/data/*.ts` 纯函数）提供默认值与 fallback 链：如 `avatar` fallback、`IP属地：`/`姓名：`前缀剥离、数字越界兜底。
- Schema 精确化原则：先声明 Model 构造器实际访问的字段，其余保持宽松（`docs/planning/roadmap.md` Phase 2）。
- 新增/修改 Schema 前 MUST 先获取真实 API 响应存为 fixture（数据驱动开发，见 `AGENTS.md`）。

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
  index.ts                  # 公共导出（VERSION + types + WeiboSDK + telemetryJsonl）
  WeiboSDK.ts               # 门面，11 个 Service（含 ArchiveService）
  capabilities.ts           # 能力清单（auth / guestPagination / guestNote / accountScoped）
  utils/telemetryJsonl.ts   # P2-3 JSONL telemetry 消费端
  utils/cookieInput.ts      # Cookie header / Netscape / header 文件解析
  cli.ts                    # CLI 入口（citty）
  cli/commands/*.ts         # user / tweet / follow / favorite / like / comment / media / notification / search
  types/
    config.ts hooks.ts telemetry.ts resources.ts index.ts session.ts
    domain/{IUser,ITweet,IUserMediaAsset,IGroup,ILiker,INotification}.ts
    raw/{user,tweet,side,search}/**   # 原始响应类型（z.infer 替代中）
  services/
    public/{User,Tweet,Followings,Favorite,Like,CommentHistory,Media,Notification,Topic,Trends,Search}Service.ts
    internal/{FetcherService,AuthService,AuthProvider,GuestTokenService,RateLimitService,RetryPolicy,EndpointSpec}.ts
    endpoints/{user,tweet,search,side,follow,favorite,like,commentHistory,media,likers,mentions,notifications,groups,topic,mobile}.ts
  models/
    data/{User,Tweet,Media,Group,Notification}.ts    # 领域模型归一化（纯函数）
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
- `AGENTS.md` — 仓库级硬约束（文档即事实 / 数据驱动 / 测试策略）

**文档结束**
