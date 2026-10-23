---
title: followings
outline: deep
---

# followings

关注与粉丝列表。Cookie 模式可完整分页。

| 方法 | 返回 | 分页 | 访客 |
|---|---|---|---|
| `getFollowings(uid, page?)` | `FriendshipsResponse` | `page` | 第一页 |
| `getFans(uid, page?)` | `FriendshipsResponse` | `page` | 第一页 |
| `getMyFollowings(page?)` | `FollowContentResponse` | `page` | 需 Cookie |
| `streamFollowings(uid, options?)` | `FollowingUser` 流 | `page` | 第一页 |
| `streamFans(uid, options?)` | `FollowingUser` 流 | `page` | 第一页 |
| `streamMyFollowings(options?)` | `FollowingUser` 流 | `page` | 需 Cookie |

访客走 m 站容器，只拿到第一页，`next_cursor` 为 `0`，`page > 1` 抛 `CONFIG_INVALID`；`getMyFollowings` / `streamMyFollowings` 需要 Cookie。详见 [访客限制](/guide/limitations)。

`FollowingUser` 是 `friendships.users[]` 的条目，保留上游字段（`id` / `idstr` / `screen_name` / `followers_count` 等）。

## `getFollowings(uid, page?)`

```ts
const page = await sdk.followings.getFollowings('1111681197', 1)
page.users
page.total_number
page.next_cursor
```

返回校验后的上游原始响应；需要归一化字段时用 `streamFollowings`。

## `getFans(uid, page?)`

同上，`relate=fans`。

## `getMyFollowings(page?)`

读取当前登录账号的关注列表（`followContent` 端点），响应结构与 `getFollowings` 不同（`data.follows.users`）。

## `streamFollowings(uid, options?)`

```ts
for await (const user of sdk.followings.streamFollowings('1111681197', {
  page: 1,
  maxPages: 2,
  onProgress: progress => console.log(progress.page, progress.processed, progress.total),
})) {
  console.log(user.id, user.screen_name)
}
```

选项：

| 选项 | 说明 |
|---|---|
| `page` | 起始页码 |
| `maxPages` | 最多翻页数 |
| `maxItems` | 最多产出用户数 |
| `onProgress` | 每页回调，回调抛错时流继续 |

停止条件：空页、整页重复（按用户 id）、达到 `total_number`、`maxPages` / `maxItems`。

## `streamFans(uid, options?)`

与 `streamFollowings` 相同，数据源为粉丝列表。

## `streamMyFollowings(options?)`

读取当前登录账号的关注列表，参数里没有 uid。

## CLI

```bash
weibo-cli follow list 1111681197
weibo-cli follow stream 1111681197 --max-pages 2
weibo-cli follow fans 1111681197
weibo-cli follow fans-stream 1111681197 --max-pages 2
weibo-cli follow my --max-pages 2
```
