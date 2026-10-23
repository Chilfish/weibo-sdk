# 公开输出归一化（camelCase 契约）

**状态**：已完成并归档（2026-10-23）。历史记录，不主动读取。
**目标**：下游从 SDK 拿到的所有数据都是归一化后的 camelCase 领域模型；上游 snake_case 只存在于显式的 `fetchRaw*` 低层入口。

## 1. 问题

领域模型（`ITweet` / `IUser` / 归档契约）已经是 camelCase，但一批公开方法仍把上游 raw 原样返回：

| 方法 | 当前返回 | 泄漏的上游字段 |
|---|---|---|
| `followings.getFollowings` / `getFans` / `getMyFollowings` | `FriendshipsResponse` / `FollowContentResponse` | `screen_name`、`followers_count`、`idstr`、`next_cursor`、`data.follows` |
| `followings.stream*` | `FollowingUser`（= raw 条目） | 同上 |
| `tweets.comments` / `replies` | `BuildCommentsResponse` | `data[].idstr`、`floor_number`、`total_number`、`max_id` |
| `tweets.getReposts` | `RepostTimelineResponse` | `data[].mblogid`、`total_number` |
| `tweets.longText` | `LongtextResponse` | `data.longTextContent_raw` |
| `tweets.searchByDate` | `SearchProfileResponse` | `data.total`、`data.list[].mblogid` |
| `favorites.getFavorites` / `getTags` | `FavoritesResponse` / `FavoritesTagsResponse` | `data.status`、`total_number` |
| `trends.hotBand` | `BandUnifiedResponse` | `data.realtime[].label_name` / `icon_desc` |
| `users.myDetails` | `UserDetailsResponse` | `desc_text`、`ip_location`、`label_desc`、`verified_url` |
| `search.searchUsers` / `searchTweets` | `SearchUsersResponse` / `SearchTweetsResponse` | `card_group[].user.screen_name` |

包根还导出了 42 个 `z.infer` 的 `*Response` 类型，下游一旦 import 就会被 snake_case 绑住。

`docs/engineering/api-stability.md` 已把这些标为 Experimental，但「Experimental」只说明可以变，并没有解决「难用」。

## 2. 已拍板

1. **公开方法一律返回归一化 camelCase 模型**（breaking change，0.x 内允许）。
2. **上游形状只保留在显式 `fetchRaw*` 方法**。方法名以 `fetchRaw` 开头，返回 `z.infer` 端点响应。
3. **包根不再导出 raw 响应类型**。`fetchRaw*` 的返回类型仍可被 TS 推导使用，但不作为包根公共名称；`website/api/types/raw.md` 改为「raw 形状说明 + `fetchRaw*` 清单」。
4. **telemetry / hooks / logger 保持 Wide Events 现有字段**（`event_name` / `trace_id` / `duration_ms`）。它们是可观测性事件契约，不是微博数据。
5. 不保留兼容别名（沿用 0.x 做法）；删除被归一化方法取代的重复入口。

命名沿用 [指南的约定](../../website/guide/index.md)：

| 前缀 | 返回 |
|---|---|
| `get*` | 单个实体或一页数据 |
| `list*` | 一页数据（`*PageResult`） |
| `stream*` | `AsyncIterableIterator<T>` |
| `fetchRaw*` | 上游原始响应（snake_case） |

## 3. 新契约

### 3.1 用户简版 `UserBrief`

替代 `FollowingUser`，用于关注 / 粉丝 / 用户搜索：

```ts
interface UserBrief {
  id: string
  name: string
  avatar: string
  url: string
  description?: string
  location?: string
  gender: Gender
  stats: { followers: number, friends: number, statuses: number }
  verified: boolean
  verifiedType: VerificationType
  verifiedReason?: string
  /** 当前登录用户是否关注 TA（上游 following） */
  following?: boolean
  /** TA 是否关注当前登录用户（上游 follow_me） */
  followedBy?: boolean
}
```

缺失计数按 `0` 处理，与 `IUser.stats` 一致；m 站的 `"2.7万"` 由 `parseMobileCount` 解析。

### 3.2 followings

```ts
interface FollowingPageResult {
  users: UserBrief[]
  /** 仅 getMyFollowings：特别关注分组 */
  specialAttention?: UserBrief[]
  cursor?: number
  hasMore: boolean
  total?: number
}
```

| 方法 | 新返回 | raw 入口 |
|---|---|---|
| `getFollowings(uid, page?)` | `FollowingPageResult` | `fetchRawFollowings(uid, page?)` |
| `getFans(uid, page?)` | `FollowingPageResult` | `fetchRawFans(uid, page?)` |
| `getMyFollowings(page?)` | `FollowingPageResult` | `fetchRawMyFollowings(page?)` |
| `stream*` | `UserBrief` | — |

### 3.3 tweets

```ts
interface TweetCommentsPageResult {
  comments: ITweetComment[]
  /** 下一页游标（上游顶层 max_id；0 = 到底） */
  cursor: number
  hasMore: boolean
  total?: number
  /** 上游提示（防火墙 / tip） */
  notice?: string
}

interface TweetRepostsPageResult {
  reposts: ITweet[]
  page: number
  hasMore: boolean
  total?: number
  maxPage?: number
}

interface TweetLongText {
  text: string
  isMarkdown?: boolean
}

interface TweetSearchByDatePageResult {
  tweets: ITweet[]
  page: number
  total?: number
  hasMore: boolean
}
```

| 方法 | 新返回 | raw 入口 |
|---|---|---|
| `comments(mblogId, options?)` | `TweetCommentsPageResult` | `fetchRawComments(mblogId, options?)` |
| `replies(mblogId, rootCommentId, options?)` | `TweetCommentsPageResult` | `fetchRawComments` |
| `longText(mblogId)` | `TweetLongText` | `fetchRawLongText(mblogId)` |
| `getReposts(mblogId, options?)` | `TweetRepostsPageResult` | `fetchRawReposts(mblogId, options?)` |
| `searchByDate(uid, options?)` | `TweetSearchByDatePageResult` | `fetchRawSearchByDate(uid, options?)` |

长文 `text` 优先 `longTextContent_raw`，缺失时退回 `longTextContent`（与 `enrich` 现有行为一致）。

### 3.4 favorites

`getFavorites` 与已归一化的 `listFavorites` 重复，直接删除；raw 入口为 `fetchRawFavorites`。

```ts
interface FavoriteTag {
  id?: string
  name?: string
}

interface FavoriteTagList {
  tags: FavoriteTag[]
  total?: number
}
```

| 方法 | 新返回 | raw 入口 |
|---|---|---|
| `listFavorites` | `FavoritePageResult`（不变） | `fetchRawFavorites(uid, page?)` |
| `getTags()` | `FavoriteTagList` | `fetchRawTags()` |

标签元素结构尚无真实样本：按 `id` / `idstr` / `tag_id` / `tagid` 与 `name` / `tag_name` / `title` / `tag` 做 best-effort 映射，无法识别的元素跳过。

### 3.5 trends

```ts
interface TrendItem {
  word: string
  heat?: number
  category?: string
  label?: string
  icon?: string
  flag?: number
  schemeUrl?: string
}
```

`hotBand(type)` → `TrendItem[]`；raw 入口 `fetchRawBand(type)`。

### 3.6 users

```ts
interface ISelfProfile {
  uid?: string
  createdAt?: string
  description?: string
  ipLocation?: string
  gender: Gender
  birthday?: string
  school?: string
  creditLevel?: string
  followers?: number
  labelDesc?: IUserLabel[]
  links: Array<{ title: string, url: string }>
  realName?: string
  company?: string
  hometown?: string
}
```

| 方法 | 新返回 | raw 入口 |
|---|---|---|
| `myDetails()` | `ISelfProfile` | `fetchRawMyDetails()` |
| `fetchRawInfo` / `fetchRawDetails` | 不变 | — |

`WeiboSessionContext.details` 改名为 `profile?: ISelfProfile`；uid 由 `verified_url` 解析后放在 `profile.uid`，会话上的 `uid` 保持不变。

### 3.7 search

```ts
interface SearchUserPageResult {
  users: UserBrief[]
  page: number
  total?: number
  hasMore: boolean
}

interface SearchTweetPageResult {
  tweets: ITweet[]
  page: number
  total?: number
  hasMore: boolean
}
```

两个搜索接口仍是 known-issue（真实调用抛 `API_BAD_RESPONSE`），但返回形状不再是 raw。raw 入口 `fetchRawSearchUsers` / `fetchRawSearchTweets`。

## 4. 影响面

- **代码**：`types/domain`（`UserBrief`、`ISelfProfile`、`TrendItem`）、`models/data`（用户 / 趋势 / 收藏标签归一化）、6 个 public service、`WeiboSDK` 会话、CLI 命令与 `models/view`。
- **导出面**：`api-surface.json` 删除 42 个 raw 响应类型与 `FollowingUser`，新增 `UserBrief` / `ISelfProfile` / `TrendItem` / `FavoriteTag` / `FavoriteTagList` 及新的 page result；`api-surface.snapshot.json` 用 `pnpm check:api --write` 重写。
- **文档**：`website/api/*`（每个方法示例改 camelCase）、`website/api/types/raw.md`、`website/guide/index.md` 命名约定、`website/cli/index.md`、`playground/*`、`CHANGELOG.md`。
- **测试**：断言 raw 形状的组件 / 单元测试改断言归一化模型；fixture 不动。

## 5. 提交拆分

1. `docs(planning): 公开输出归一化实施计划`（本文件 + 索引 + 开发日志）
2. `feat(types): 增加 camelCase 用户 / 趋势 / 会话资料模型`
3. `feat(models): 归一化用户简版 / 趋势 / 收藏标签`
4. `feat(followings): 返回归一化 UserBrief 分页`
5. `feat(tweets): 评论 / 转发 / 长文 / 日期检索返回归一化模型`
6. `feat(favorites,trends,users,search): 公开输出归一化`
7. `refactor(api): 移除 raw 响应类型根导出并更新导出面`
8. `test: 对齐归一化输出断言`
9. `docs: 同步公开文档 / playground / CHANGELOG`

## 6. DoD

- [x] 公开方法不再返回 snake_case 对象（`fetchRaw*` 除外）
- [x] 包根不再导出 `*Response` raw 类型
- [x] `pnpm typecheck` / `pnpm test` / `pnpm check:api` / `pnpm check:docs` / `pnpm docs:build` 全绿
- [x] `CHANGELOG.md` 有迁移说明

## 7. 结果（2026-10-23）

- 新增 `UserBrief` / `ISelfProfile` / `TrendItem` / `FavoriteTag` 与 6 个 `*PageResult`。
- 6 个 public service 的公开方法全部返回 camelCase 模型；raw 入口统一为 `fetchRaw*`。
- 包根导出从 302 降到 267，raw 响应类型不再公开。
- `pnpm test`：971 passed / 28 skipped；CLI 用真实 Cookie 冒烟通过。
