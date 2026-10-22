---
title: notifications
outline: deep
---

# notifications

评论通知与点赞通知。账号级能力，需要 Cookie。

| 方法 | 返回 | 分页 | 访客 | 稳定性 |
|---|---|---|---|---|
| `listComments(options?)` | `CommentNotificationPageResult` | `maxId` / `page` | 不可用 | 稳定 |
| `streamComments(options?)` | `CommentNotification` 流 | `maxId` | 不可用 | 稳定 |
| `listLikes(options?)` | `LikeNotificationPageResult` | `maxId` / `page` | 不可用 | 稳定 |
| `streamLikes(options?)` | `LikeNotification` 流 | `maxId` | 不可用 | 稳定 |

## `listComments(options?)`

| 选项 | 类型 | 说明 |
|---|---|---|
| `maxId` | `number \| string` | 上一页的 `cursor`，优先于 `page` |
| `page` | `number` | 页码，未给 `maxId` 时生效 |

返回 `{ cursor, hasMore, total?, items: CommentNotification[] }`。已删除的微博 / 评论会被跳过。

## `streamComments(options?)`

```ts
for await (const item of sdk.notifications.streamComments({
  maxPages: 3,
  since: '2026-01-01',
})) {
  console.log(item.createdAt, item.text, item.user.name)
}
```

选项：`maxId`、`page`、`maxPages`、`maxItems`、`since`、`until`、`onProgress`。

## `listLikes(options?)`

同评论通知，返回 `LikeNotificationPageResult`。

## `streamLikes(options?)`

选项与停止条件同上。

## 通知项字段

`CommentNotification` / `LikeNotification` 见 [领域模型](/api/types/domain#通知)。

## 错误与边界

- 访客调用抛 `AUTH_SESSION_EXPIRED`（`context.requiredAuth = 'cookie'`）。
- `total_number` 存在时用于观察，不作为流的唯一停止条件。

## CLI

```bash
weibo-cli notification comments
weibo-cli notification comments-stream --max-pages 2
weibo-cli notification likes
weibo-cli notification likes-stream --max-pages 2
```
