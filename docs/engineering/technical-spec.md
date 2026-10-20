# 微博 SDK 技术规格书

**版本**: 2.2.0
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
 ├─ preflight（除非 skipPreflight）——selfCheck（lazy/eager）
 ├─ emit request_start（telemetry + hooks）
 ├─ rateLimitService.acquire()  ← 令牌桶，等待时 emit rate_limit_wait（含 432 后的全局暂停）
 ├─ 注入请求头：referer / host / user-agent / Auth(cookie+xsrf)
 ├─ axios 请求
 │   └─ 失败 → mapError：429/432 → RATE_LIMITED；ECONNABORTED/ETIMEDOUT → NET_TIMEOUT；其余 → NET_REQUEST_FAILED
 ├─ 重试循环（config.retry，默认 2 次）：可重试错误 → 指数退避 + jitter（Retry-After 优先）→ emit request_retry → 重新 acquire
 │   └─ 432/429 命中即 `rateLimitService.pause(delay)`，暂停全局令牌桶
 ├─ okPolicy 校验（require_ok_1）（不重试）
 │   └─ ok !== 1 → API_NOT_OK（或 myDetails 的 AUTH_SESSION_EXPIRED）
 ├─ Zod safeParse（不重试）
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
| `pageInfo` | `TweetPageCard` | OPTIONAL | 链接/视频卡片 |
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

**链接卡片**（`TweetLinkCard`）：`title` / `url` / `shortUrl?` / `pageId?` / `objectType?` / `typePic?`。

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

  constructor(config: IWeiboConfig)          // cookie 为空抛 InvalidConfigError
  async selfCheck(): Promise<void>           // 配置 + 会话自检
  async checkSession(): Promise<boolean>     // 非抛错会话检查
}
```

### 3.2 配置: IWeiboConfig

```typescript
interface IWeiboConfig {
  cookie: string                              // REQUIRED：header 串或 Cookie 文件路径（仅 Node）
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
| `streamMentions` | `({ maxId?, page?, maxPages?, onProgress? }?) => AsyncIterableIterator<Tweet>` | 游标翻页 + 跨页 `mblogid` 去重；`next_cursor === 0` / 空页 / 游标不前进停止 |
| `groups` | `() => Promise<UserGroup[]>` | `/ajax/feed/allGroups` 拍平（`groups[].group[]`），按 `gid` 去重 |
| `mblogGroups` | `() => Promise<MblogGroup[]>` | `/ajax/mblog/querygroup` 的 `data.join_groups` |

**TweetService**（`sdk.tweets`）

| 方法 | 签名 | 说明 |
|---|---|---|
| `myMblog` | `(uid, page?, count?) => Promise<MyMblogResponse>` | 用户微博列表（raw，page 游标；**@deprecated**：用 `listByUserId` / `streamByUserId`） |
| `listByUserId` | `(uid, { page?, count? }?) => Promise<TweetPageResult>` | 归一化列表 + 广告过滤 + `hasMore` |
| `streamByUserId` | `(uid, options?) => AsyncIterableIterator<Tweet>` | 自动翻页流式 |
| `show` | `(mblogId, isGetLongText?) => Promise<StatusShowResponse>` | 微博详情（raw；**@deprecated**：用 `getByMblogId`） |
| `getByMblogId` | `(mblogId, isGetLongText?) => Promise<Tweet>` | 归一化详情 |
| `enrich` | `(mblogId, { isGetLongText?, includeLongText? }?) => Promise<TweetEnrichResult>` | raw 响应 + 归一化模型（+ 可选长微博全文），不改变 `ITweet` v1 |
| `comments` | `(mblogId, options?) => Promise<BuildCommentsResponse>` | 评论列表 |
| `longText` | `(mblogId) => Promise<LongtextResponse>` | 长微博全文 |
| `getReposts` | `(mblogId, { page?, count? }?) => Promise<RepostTimelineResponse>` | 转发列表 |
| `searchByDate` | `(uid, options?) => Promise<SearchProfileResponse>` | 日期范围搜索（`starttime` / `endtime` 接受 **unix 秒**或 `YYYY-MM-DD` / `YYYYMMDD`，字符串在请求前换算为秒，日期取本地时区） |
| `friendTimeline` | `(options?) => Promise<FriendstimelineResponse>` | 首页「最新微博」关注时间线（raw；**@deprecated**：用 `listFriendTimeline`） |
| `listFriendTimeline` | `({ max_id?, since_id?, list_id?, fid?, count?, refresh? }?) => Promise<TweetPageResult>` | 首页「最新微博」（归一化）；`max_id` 翻旧页，`since_id` 只做增量过滤 |
| `streamFriendTimeline` | `({ maxId?, sinceId?, listId?, fid?, refresh?, count?, maxPages?, onProgress? }?) => AsyncIterableIterator<Tweet>` | `max_id` 自动翻页 + 跨页 `mblogId` 去重；`sinceId` 只请求一页增量 |
| `likers` | `(mid, { page? }?) => Promise<TweetLikersPageResult>` | 微博点赞者单页（m 站 `api/attitudes/show`；入参必须是数字 mid） |
| `streamLikers` | `(mid, { page?, maxPages?, onProgress? }?) => AsyncIterableIterator<TweetLiker>` | page 翻页 + 跨页用户 id 去重；空页 / 整页重复 / 达到 total 停止 |

> `TweetEnrichResult = { tweet: Tweet, raw: StatusShowResponse, longText?: string }`：`raw` 为 passthrough 的 `statuses/show` 原始响应，调用方自行落盘；`longText` 仅在 `includeLongText: true` 时请求。
> `TweetPageResult = { page?: number, maxId?: string, sinceId?: string, hasMore: boolean, total?: number, tweets: Tweet[] }`。
> 分页游标按端点分：`mymblog`（`listByUserId`/`streamByUserId`）用 `page`（下一页页码；2026-08 曾弃用 `since_id`，2026-10-20 复测 `since_id` 与 `page` 均可用且等价，归一化仍以 `page` 为主）；
> `friendstimeline`（`listFriendTimeline`/`streamFriendTimeline`）用 `maxId` 翻旧页（响应 `max_id`；`0` = 到底），`since_id` 只做增量过滤；`total_number` 实测恒为 2000 上限值，不能当作剩余条数。`mymblog.data.since_id` 的 raw 类型为 `string | number`。

**FollowingsService**（`sdk.followings`）：`getFollowings(uid, page?)`（关注）/ `getFans(uid, page?)`（粉丝，`relate=fans`）/ `getMyFollowings(page?)`——均返回 `FriendshipsResponse`
**FavoriteService**（`sdk.favorites`）：

| 方法 | 签名 | 说明 |
|---|---|---|
| `getFavorites` | `(uid, page?) => Promise<FavoritesResponse>` | raw 收藏响应（`data.status` / `data.total_number`；`page < 1` 按未指定处理） |
| `listFavorites` | `(uid, { page?, tag? }?) => Promise<FavoritePageResult>` | 单页归一化 + 页内去重 + 客户端标签过滤 |
| `streamFavorites` | `(uid, { page?, tag?, maxPages?, onProgress? }?) => AsyncIterableIterator<Tweet>` | 自动翻页 + 跨页去重 + 标签过滤 |
| `getTags` | `() => Promise<FavoritesTagsResponse>` | 收藏夹标签清单 |

> `FavoritePageResult = { page: number, hasMore: boolean, total?: number, totalPages?: number, tweets: Tweet[] }`。
> `hasMore` 优先用顶层 `total_page`，缺失时退回 `total_number` 估算；流式路径另有「整页重复即停止」保护。
> `tag` 为**客户端过滤**：上游 `all_fav` 忽略 `tag_id` / `tag` 参数；匹配收藏项自带 `tags` 的 id / 名称。
> `page=0` 实测上游 HTTP 400，SDK 统一按第一页处理。

**LikeService**（`sdk.likes`）：

| 方法 | 签名 | 说明 |
|---|---|---|
| `listByUserId` | `(uid, { page? }?) => Promise<LikePageResult>` | 单页归一化 + 页内 `mblogid` 去重；`hasMore` = 本页去重后非空 |
| `streamByUserId` | `(uid, { page?, maxPages?, onProgress? }?) => AsyncIterableIterator<Tweet>` | 自动翻页 + 跨页去重；空页 / 整页重复 / `maxPages` 停止 |

> 端点 `GET /ajax/statuses/likelist?uid=&page=`：真实响应只有 `data.list`，**无 total / cursor / hasMore**；`page=0` 与 `page=1` 等价，越界页返回 200 + 空数组。旧的 `/ajax/statuses/likes` 已下线（200 + HTML 404 页）。

**CommentHistoryService**（`sdk.commentHistory`）：

| 方法 | 签名 | 说明 |
|---|---|---|
| `listMine` | `({ maxId?, page? }?) => Promise<CommentHistoryPageResult>` | 单页归一化 + 去重；`cursor = data.next_cursor`，`hasMore = cursor !== 0 && comments.length > 0` |
| `streamMine` | `({ maxId?, page?, maxPages?, onProgress? }?) => AsyncIterableIterator<ITweetComment>` | 游标翻页 + 跨页去重；`next_cursor === 0` / 空页 / 游标不前进 / 整页重复 / `maxPages` 停止 |

> 端点 `GET /ajax/message/myCmt`：翻页用 `max_id=<上一页 data.next_cursor>`（`page` 等价，`cursor` 被忽略）；`next_cursor === 0` 表示到底。只读当前登录用户自己的历史评论，端点不接受 uid。
> `ITweetComment` 在 v1 内新增 optional `rootId` / `replyTo` / `floorNumber` / `totalReplies` / `liked` / `parentMblogId` / `pics`；不挂完整 `parentTweet`。
> `pics`（`TweetCommentPic[]`）来自上游 `url_struct[].pic_infos`（图片评论），按 `pic_id` 去重；URL 同为临时签名 URL。

**MediaService**（`sdk.media`）：
| 方法 | 签名 | 说明 |
|---|---|---|
| `listImages` | `(uid, { sinceId? }?) => Promise<ImageWallPageResult>` | 图片墙单页；`sinceId` 为上一页 `data.since_id`；过滤缺 `pid` 的破损条目 |
| `streamImages` | `(uid, { sinceId?, maxPages?, onProgress? }?) => AsyncIterableIterator<IUserMediaAsset>` | 图片墙自动翻页 + 跨页按 `pid` 去重 |
| `listVideos` | `(uid, { cursor? }?) => Promise<VideoWaterfallPageResult>` | 视频瀑布单页；`cursor` 为上一页 `data.next_cursor`；从 `page_info.media_info` 提取视频 |
| `streamVideos` | `(uid, { cursor?, maxPages?, onProgress? }?) => AsyncIterableIterator<IUserMediaAsset>` | 视频瀑布自动翻页 + 跨页按资产 id 去重 |
| `fetchRawImagePage` | `(uid, { sinceId? }?) => Promise<ImageWallResponse>` | 图片墙原始页（归档 `schemaDigest`） |
| `fetchRawVideoPage` | `(uid, { cursor? }?) => Promise<WaterfallResponse>` | 视频瀑布原始页（归档 `schemaDigest`） |
| `listAlbums` | `(uid) => Promise<AlbumListResult>` | 相册列表（`getImageWall?has_album=true` 的 `album_list`） |
| `listAlbumPhotos` / `streamAlbumPhotos` | `(containerId, { sinceId?, maxPages? }?)` | 相册照片（`getAlbumDetail`，`since_id` 游标） |
| `downloadTweetMedia` | `(tweet, options) => Promise<TweetMediaDownloadResult>` | 单条微博媒体下载（Node-only；失败聚合） |
| `downloadByMblogId` | `(mblogId, options) => Promise<TweetMediaDownloadResult>` | 先拉详情（不补长文）再下载 |

> 端点：`GET /ajax/profile/getImageWall?uid=&sinceid=`（首屏 `sinceid=0`，`sinceid=-1` 等同第一页）；`GET /ajax/profile/getWaterFallContent?uid=&cursor=`（首屏 `cursor=0`，**`cursor=-1` 会 HTTP 400**）。两者停止条件均为「空页 / 游标缺失 / 游标不前进 / `maxPages`」。
> 下载使用独立 CDN 客户端（不携带 Cookie，仅 Referer + host 白名单），与 API 令牌桶隔离；临时文件 + 原子 rename；403/404/410 单飞刷新一次。详见 [media-download.md](./media-download.md)。

**NotificationService**（`sdk.notifications`）：
| 方法 | 签名 | 说明 |
|---|---|---|
| `listComments` | `({ maxId?, page? }?) => Promise<CommentNotificationPageResult>` | 评论通知单页；每项 `{ comment, tweet }` |
| `streamComments` | `({ maxId?, page?, maxPages?, onProgress? }?) => AsyncIterableIterator<CommentNotification>` | 游标翻页 + 跨页评论 id 去重 |
| `listLikes` | `({ maxId?, page? }?) => Promise<LikeNotificationPageResult>` | 点赞通知单页；每项 `{ id, createdAt, attitude, source, user, tweet }` |
| `streamLikes` | `({ maxId?, page?, maxPages?, onProgress? }?) => AsyncIterableIterator<LikeNotification>` | 游标翻页 + 跨页通知 id 去重 |

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
- 与请求级重试的分工（P1 可靠性）：`config.retry` 在 `FetcherService` 内先执行（同一次 HTTP 调用的退避重试）；归档级 `maxRetries` / `retryDelayMs` 只处理**编排层**失败（分页/单条），因此两者不会叠加成双倍重试风暴——归档层看到的是已耗尽请求级重试后的终态错误。
- 判别标准：≤20 行代码 + 一条 `weibo-cli archive <uid>` 命令镜像单账号。

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

`IResource` 映射 26 个资源类型：`USER_INFO` / `USER_DETAILS` / `TWEET_MYMBLOG` / `TWEET_SHOW` / `TWEET_LONGTEXT` / `TWEET_SEARCHPROFILE` / `TWEET_COMMENTS` / `TWEET_FRIENDTIMELINE` / `TWEET_REPOST_TIMELINE` / `SIDE_BANDUNIFIED` / `FAVORITES_ALLFAV` / `FAVORITES_TAGS` / `LIKES_LIST` / `COMMENTS_MINE` / `PROFILE_IMAGE_WALL` / `PROFILE_WATERFALL` / `TWEET_LIKERS` / `FEED_GROUPS` / `MBLOG_GROUPS` / `MENTIONS_STATUSES` / `MESSAGE_COMMENTS` / `MESSAGE_ATTITUDES` / `SEARCH_USERS` / `SEARCH_TWEETS` / `FRIENDSHIPS_FRIENDS` / `PROFILE_FOLLOWCONTENT`。

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
| `CONFIG_INVALID` | `InvalidConfigError` | business | ❌ | 构造时 cookie 为空 |
| `AUTH_SESSION_EXPIRED` | `WeiboSessionExpiredError` | business | ❌ | `myDetails()`（自检）返回 ok≠1 |
| `API_NOT_OK` | `WeiboAPINotOkError` | business | ❌ | 其他端点 ok≠1 |
| `API_BAD_RESPONSE` | `UnexpectedAPIResponseError` | protocol | ❌ | Zod 校验失败（`context.zodIssues`） |
| `NET_TIMEOUT` | `ConnectionTimeoutError` | transport | ✅ | 超时（`ECONNABORTED`/`ETIMEDOUT`） |
| `NET_REQUEST_FAILED` | `NetworkRequestError` | transport | ✅ | 其他网络错误（含 4xx/5xx，`context.status`） |
| `RATE_LIMITED` | `RateLimitError` | transport | ✅ | HTTP 432（微博风控）/ 429；`context` = `status` / `retryAfterMs?` / `attempt` / `message?` |
| `MEDIA_DOWNLOAD_FAILED` | `MediaDownloadError` | transport | ✅ | 媒体 CDN 5xx/429/408/超时/连接/空闲超时/截断/0 字节 |
| `MEDIA_BAD_RESPONSE` | `MediaInvalidResponseError` | protocol | ❌ | HTML/JSON、类型族不符、超上限、非法重定向 |
| `MEDIA_STORAGE_FAILED` | `MediaStorageError` | storage | ❌ | mkdir/write/rename/unlink 失败 |

错误映射链：axios error → `mapError` → TransportError（429/432 优先映射为 `RATE_LIMITED`）；`ok≠1` → BusinessError；Zod fail → ProtocolError。可重试错误由 `FetcherService` 的重试循环消费（见 §5）。错误分类详情与诊断流程见 `docs/engineering/error-diagnostics.md`。

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
  utils/telemetryJsonl.ts   # P2-3 JSONL telemetry 消费端
  utils/cookieInput.ts      # Cookie header / Netscape / header 文件解析
  cli.ts                    # CLI 入口（citty）
  cli/commands/*.ts         # user / tweet / follow / favorite / like / comment / media / notification / search
  types/
    config.ts hooks.ts telemetry.ts resources.ts index.ts
    domain/{IUser,ITweet,IUserMediaAsset,IGroup,ILiker,INotification}.ts
    raw/{user,tweet,side,search}/**   # 原始响应类型（z.infer 替代中）
  services/
    public/{User,Tweet,Followings,Favorite,Like,CommentHistory,Media,Notification,Topic,Trends,Search}Service.ts
    internal/{FetcherService,AuthService,RateLimitService,RetryPolicy,EndpointSpec}.ts
    endpoints/{user,tweet,search,side,follow,favorite,like,commentHistory,media,likers,mentions,notifications,groups,topic}.ts
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
