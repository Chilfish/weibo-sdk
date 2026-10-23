---
title: followings
outline: deep
---

# followings

关注与粉丝列表。Cookie 模式可完整分页。

| 方法 | 返回 | 分页 | 访客 |
|---|---|---|---|
| `getFollowings(uid, page?)` | `FollowingPageResult` | `page` | 第一页 |
| `getFans(uid, page?)` | `FollowingPageResult` | `page` | 第一页 |
| `getMyFollowings(page?)` | `FollowingPageResult` | `page` | 需 Cookie |
| `streamFollowings(uid, options?)` | `UserBrief` 流 | `page` | 第一页 |
| `streamFans(uid, options?)` | `UserBrief` 流 | `page` | 第一页 |
| `streamMyFollowings(options?)` | `UserBrief` 流 | `page` | 需 Cookie |
| `fetchRawFollowings(uid, page?)` | `FriendshipsResponse` | `page` | 第一页 |
| `fetchRawFans(uid, page?)` | `FriendshipsResponse` | `page` | 第一页 |
| `fetchRawMyFollowings(page?)` | `FollowContentResponse` | `page` | 需 Cookie |

访客走 m 站容器，只拿到第一页，`cursor` 为 `0`，`page > 1` 抛 `CONFIG_INVALID`；`getMyFollowings` / `streamMyFollowings` 需要 Cookie。详见 [访客限制](/guide/limitations)。

```ts
interface FollowingPageResult {
  users: UserBrief[]
  specialAttention?: UserBrief[]   // 仅 getMyFollowings
  cursor?: number                  // 下一页游标；0 / 缺省 = 到底
  hasMore: boolean
  total?: number
}
```

`UserBrief` 字段见 [领域模型](/api/types/domain#userbrief)。

## `getFollowings(uid, page?)`

```ts
const page = await sdk.followings.getFollowings('1111681197', 1)
page.users[0].name
page.users[0].stats.followers
page.cursor
page.total
```

## `getFans(uid, page?)`

同上，`relate=fans`。

## `getMyFollowings(page?)`

读取当前登录账号的关注列表（`followContent` 端点）。除 `users` 外还会返回上游单独下发的「特别关注」分组：

```ts
const page = await sdk.followings.getMyFollowings()
const all = [...(page.specialAttention ?? []), ...page.users]
```

## `streamFollowings(uid, options?)`

```ts
for await (const user of sdk.followings.streamFollowings('1111681197', {
  page: 1,
  maxPages: 2,
  onProgress: progress => console.log(progress.page, progress.processed, progress.total),
})) {
  console.log(user.id, user.name)
}
```

选项：

| 选项 | 说明 |
|---|---|
| `page` | 起始页码 |
| `maxPages` | 最多翻页数 |
| `maxItems` | 最多产出用户数 |
| `onProgress` | 每页回调，回调抛错时流继续 |

停止条件：空页、整页重复（按用户 id）、`hasMore === false`、`maxPages` / `maxItems`。

## `streamFans(uid, options?)`

与 `streamFollowings` 相同，数据源为粉丝列表。

## `streamMyFollowings(options?)`

读取当前登录账号的关注列表，参数里没有 uid。流只产出 `users`，特别关注用 `getMyFollowings` 读取。

## raw 入口

需要上游原始字段（`screen_name` / `followers_count` / `next_cursor`）时用 `fetchRawFollowings` / `fetchRawFans` / `fetchRawMyFollowings`。这些方法返回与微博接口同形的 snake_case 数据。

## CLI

```bash
weibo-cli follow list 1111681197
weibo-cli follow stream 1111681197 --max-pages 2
weibo-cli follow fans 1111681197
weibo-cli follow fans-stream 1111681197 --max-pages 2
weibo-cli follow my --max-pages 2
```
