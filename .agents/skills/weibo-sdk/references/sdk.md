# weibo-sdk SDK 参考

源码直跑：`import { WeiboSDK } from '<repo>/src/index.ts'`，用 `bun script.ts` 执行。
仓库内脚本可以 `import { WeiboSDK } from '@chilfish/weibo-sdk'`（tsconfig paths → `src/index.ts`）。

## 构造

```ts
new WeiboSDK({})                              // auth: 'auto' → 没 Cookie 就是访客
new WeiboSDK({ cookie })                      // Cookie header 串 / Netscape cookies.txt 路径 / header 文本文件
new WeiboSDK({ auth: 'guest' })               // 强制访客，忽略传入的 Cookie
new WeiboSDK({ auth: 'cookie', cookie })      // 没有 Cookie 构造时抛 CONFIG_INVALID
new WeiboSDK({ guest: { token: 'SUB=...', issuer: 'mobile', autoRefresh: true } })
new WeiboSDK({ retry: { retries: 3, baseDelayMs: 500, retryOn: ['rate_limit'] } })
new WeiboSDK({ proxy: 'http://127.0.0.1:7890' })   // 或 { getProxy: ctx => ... }，false = 直连
```

`auth: 'auto'` **不会**在 Cookie 过期后静默降级到访客：能读到的范围不同，静默降级等于交给调用方不完整的数据。

## 服务与方法

| 服务 | 方法 | 鉴权 | 游标 |
|---|---|---|---|
| `sdk.users` | `myDetails()` / `info()` / `details()` / `getById(uid)` / `listMentions()` / `streamMentions()` / `groups()` / `mblogGroups()` | cookie（`info` / `getById` 访客可读） | max_id |
| `sdk.tweets` | `getByMblogId()` / `context()` / `enrich()` / `longText()` / `listByUserId()` / `streamByUserId()` / `comments()` / `streamComments()` / `replies()` / `streamReplies()` / `getReposts()` / `streamReposts()` / `likers()` / `streamLikers()` / `listFriendTimeline()` / `streamFriendTimeline()` / `searchByDate()` | 多数访客可读；`friendTimeline` / `searchByDate` 需 cookie | max_id / page |
| `sdk.followings` | `getFollowings()` / `streamFollowings()` / `getFans()` / `streamFans()` / `getMyFollowings()` / `streamMyFollowings()` | cookie | page |
| `sdk.favorites` | `getFavorites()` / `listFavorites()` / `streamFavorites()` / `getTags()` | cookie | page |
| `sdk.likes` | `listByUserId()` / `streamByUserId()` | cookie | page |
| `sdk.commentHistory` | `listMine()` / `streamMine()` | cookie | max_id |
| `sdk.media` | `listImages()` / `streamImages()` / `listVideos()` / `streamVideos()` / `listAlbums()` / `listAlbumPhotos()` / `streamAlbumPhotos()` / `downloadTweetMedia()` / `downloadByMblogId()` | 访客可读；下载无需 Cookie | since_id / cursor |
| `sdk.topics` | `cates()` / `list()` / `stream()` | 访客可读 | page |
| `sdk.trends` | `hotBand()` | 访客可读 | – |
| `sdk.notifications` | `listComments()` / `streamComments()` / `listLikes()` / `streamLikes()` | cookie | max_id |
| `sdk.search` | `searchUsers()` / `searchTweets()` | cookie（上游目前 unavailable） | page |
| `sdk.archive` | `streamArchive(uid, opts)` / `streamUsersArchive(uids, opts)` | cookie | mixed |

`list*` 返回一页，`stream*` 返回 async iterator；所有 `stream*` 接受 `maxPages` / `maxItems`，时间倒序的还接受 `since` / `until`。
`getSession()` 返回 `{ authMode, uid, details, checkedAt, guestTokenIssuedAt }`，复用启动自检的请求、按实例缓存；`{ refresh: true }` 才重新探测。
`capabilities()` 返回每个能力的 `auth` / `guestPagination` / `accountScoped` / `pagination`。

## 模型字段

### `ITweet`（存档契约 v1，只增不改）
必填：`id`（数字串）、`mblogId`、`createdAt`（上游原样字符串，含时区）、`text`、`textHtml`、`source`、`user`（`TweetUser` 简版）、`stats{likes,comments,reposts}`、`visible`、`media[]`。
可选：`regionName`、`retweetedStatus`（同构递归）、`repostChain[]`、`pageInfo`、`geo`、`topics[]`、`linkCards[]`、`readCount`、`editCount`、`title`、`permanentVideoUrl`、`isOriginal`、`sourceUrl`、`atUsers[]`、`playCount`、`isTop`、`audio[]`、`comments[]`（仅归档 `includeComments` 时填充）。

`media[]` 元素：`{ id, type: 'pic'|'video'|'gif'|'livephoto'|..., imageUrl, videoUrl?, duration?, width?, height? }`。
**媒体 URL 是短期签名地址**，带 `Expires` / `ssig`，归档要立即下载。

### `ITweetComment`
`id`、`createdAt`、`text`、`textHtml`、`source`、`likes`、`user`，以及楼中楼 `replies[]`、图片评论 `pics[]`、`rootId`、`replyTo`、`floorNumber`、`totalReplies`、`liked`、`parentMblogId`。
`replies` 是「谁回复了这条」，`replyTo` 是「我回复了谁」，两者独立。

### `ITweetContext`（`weibo.tweet-context/v1`）
确定性投影，不调用 LLM、不做总结：
- `post`：`kind: 'original'|'repost'`、作者、正文、`flags`（`isAd` / `isPaid` / `textTruncated` / `edited` / `pinned`）、`stats`
- `quoted`：转发的原微博（含自己的 `media[]`，归属 `quoted`）
- `media[]`：`relation: 'self'|'quoted'`、临时 URL、封面、尺寸、时长、`hints`（如 `video:needs_transcript`）
- `provenance`：抓取时间、来源（`sdk.tweets.context (guest)`）、原文 URL
- `unknowns[]`：还没补的东西（图片无描述、视频无字幕、评论为抽样）
- `hints[]`：如 `quoted_post:author_is_not_the_poster`

### 归档产物
`streamArchive` 产出 `ArchiveItem`：`{ uid, source, tweet?, asset?, checkpoint, ... }`。
- `source` ∈ `timeline` / `repost` / `favorite` / `like` / `comment` / `image` / `video`
- `asset` 为 `IUserMediaAsset`（`id` / `type` / `url` / `coverUrl` / `sourceTweetId` / `createdAt` / `objectId`），图片项可能没有 `tweet`
- `checkpoint` 记录最后一条完整处理的项；续跑 at-least-once，按 `mblogId`（媒体按 `asset.id`）幂等去重
- 归档文件的 JSON Schema 在仓库 `schemas/weibo-user-archive/v1.json`，由 `pnpm schema:archive` 生成；`pnpm schema:check` 检查漂移

## 示例

```ts
import { WeiboSDK } from '/workspace/projects/weibo-sdk/src/index.ts'

const sdk = new WeiboSDK({ auth: 'guest' })

// 分页 + 流式
const page = await sdk.tweets.listByUserId('1111681197')
for await (const t of sdk.tweets.streamByUserId('1111681197', { maxPages: 2, maxItems: 50 }))
  console.log(t.mblogId, t.createdAt, t.text.slice(0, 40))

// 单条上下文
const ctx = await sdk.tweets.context('Rnzctqb28', { comments: 5 })

// 归档 + 断点（需要 cookie）
for await (const item of sdk.archive.streamArchive(uid, {
  includeLikes: true,
  includeImages: true,
  incremental: { since: '2026-01-01', stopAtMblogId: lastSeenId, skipPinned: true },
})) {
  if (item.tweet) await save(item.tweet)
  if (item.asset) await saveAsset(item.asset)
  await saveCheckpoint(item.checkpoint)
}
```

## 错误

所有错误继承 `WeiboSDKError`，带 `code`、`level`（`business` / `config` / `protocol` / `transport` / `media`）、`retryable`、`endpoint`、`context`、`traceId`。

| 类 | `code` |
|---|---|
| `BusinessError` | `API_NOT_OK`、`AUTH_SESSION_EXPIRED`（`context.requiredAuth`） |
| `ConfigError` | `CONFIG_INVALID` |
| `ProtocolError` | `API_BAD_RESPONSE` |
| `TransportError` | `NET_TIMEOUT`、`NET_REQUEST_FAILED`、`RATE_LIMITED` |
| `MediaError` | `MEDIA_BAD_RESPONSE`、`MEDIA_DOWNLOAD_FAILED`、`MEDIA_STORAGE_FAILED` |

重试只对 `retryable` 生效：4xx（除 429 / 432）、`ok != 1`、schema 校验失败一律不重试。

## 遥测

`telemetry` 配置接收 Wide Events 风格事件：`request`（带 `auth_mode`、`guest_refresh_count`）、`guest_token_issue`、`guest_token_error`、`auth_failure`（带 `auth_failure_reason`）。用于定位「是 Cookie 过期还是风控还是上游改字段」。
