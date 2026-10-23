---
title: notifications
outline: deep
---

# notifications

评论通知与点赞通知。账号级能力，需要 Cookie。

| 方法 | 返回 | 分页 |
|---|---|---|
| `listComments(options?)` | `CommentNotificationPageResult` | `maxId` / `page` |
| `streamComments(options?)` | `CommentNotification` 流 | `maxId` |
| `listLikes(options?)` | `LikeNotificationPageResult` | `maxId` / `page` |
| `streamLikes(options?)` | `LikeNotification` 流 | `maxId` |

读取 Cookie 对应账号的数据。访客调用抛 `AUTH_SESSION_EXPIRED`（`context.requiredAuth` 为 `'cookie'`），边界见 [范围与限制](/guide/limitations)。

## `listComments(options?)`

| 选项 | 类型 | 说明 |
|---|---|---|
| `maxId` | `number \| string` | 上一页的 `cursor`，优先于 `page` |
| `page` | `number` | 页码，未给 `maxId` 时生效 |

返回 `{ cursor, hasMore, total?, items: CommentNotification[] }`。已删除的微博与评论会被跳过。

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

选项与返回结构同 `listComments`，items 为 `LikeNotification[]`。

## `streamLikes(options?)`

选项与停止条件同 `streamComments`。

## 通知项字段

`CommentNotification` / `LikeNotification` 见 [领域模型](/api/types/domain#通知)。

## 边界

流的停止由空页、整页重复、`maxPages` 与 `maxItems` 决定；`total_number` 存在时只作观察。

## CLI

```bash
weibo-cli notification comments
weibo-cli notification comments-stream --max-pages 2
weibo-cli notification likes
weibo-cli notification likes-stream --max-pages 2
```
