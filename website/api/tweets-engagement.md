---
title: tweets（评论 / 转发 / 点赞者）
outline: deep
---

# tweets（评论 / 转发 / 点赞者）

| 方法 | 返回 | 分页 | 访客 | 稳定性 |
|---|---|---|---|---|
| `comments(mblogId, options?)` | `BuildCommentsResponse` | `maxId` | 可用 | 实验性 |
| `replies(mblogId, rootCommentId, options?)` | `BuildCommentsResponse` | `maxId` | 可用 | 实验性 |
| `streamComments(mblogId, options?)` | `ITweetComment` 流 | `maxId` | 可用 | 稳定 |
| `streamReplies(mblogId, rootCommentId, options?)` | `ITweetComment` 流 | `maxId` | 可用 | 稳定 |
| `getReposts(mblogId, options?)` | `RepostTimelineResponse` | `page` | 可用 | 实验性 |
| `streamReposts(mblogId, options?)` | `ITweet` 流 | `page` | 可用 | 稳定 |
| `likers(mblogId, options?)` | `TweetLikersPageResult` | `page` | 可用 | 稳定 |
| `streamLikers(mblogId, options?)` | `TweetLiker` 流 | `page` | 可用 | 稳定 |

## `comments(mblogId, options?)`

读取 `buildComments` 原始响应。参数事实：

- 固定补齐 `is_reload=1` / `is_show_bulletin=2` / `is_mix=0` / `fetch_level=0`；
- **不要传 `type=feed`**：会静默只返回 3 条；
- `count` 被上游忽略（固定 20 条）；
- `flow=1`（时间序）要求数字 mid，传 mblogId / URL 时方法内部自动解析；
- 翻页必须用响应顶层的 `max_id`，不要用最后一条评论 id。

| 选项 | 类型 | 说明 |
|---|---|---|
| `maxId` | `number` | 上一页的顶层 `max_id` |
| `count` | `number` | 上游忽略 |
| `flow` | `0 \| 1` | 0=热度，1=时间 |
| `uid` | `string` | 读取视角 |
| `isReply` | `number` | 1 = 二级评论（第一个参数传一级评论 id） |
| `rootId` | `string \| number` | 可选透传 |
| `fetchLevel` | `number` | 0=一级，1=二级 |

## `replies(mblogId, rootCommentId, options?)`

读取一条一级评论下的二级评论。**请求的 `id` 是一级评论 id**；`mblogId` 只用于上下文（不进入请求）。等价于 `comments(rootCommentId, { isReply: 1, fetchLevel: 1 })`。

选项：`maxId`、`count`、`flow`、`uid`。

## `streamComments(mblogId, options?)`

```ts
for await (const comment of sdk.tweets.streamComments('QqsYymYOS', {
  maxPages: 3,
  flow: 0,
  maxItems: 100,
})) {
  console.log(comment.id, comment.text, comment.replies)
}
```

只产出顶层评论；楼中楼在 `comment.replies`。选项：`maxId`、`count`、`flow`、`uid`、`maxPages`、`maxItems`、`onProgress`。

停止条件：空页、整页重复、`max_id` 缺失 / 为 0 / 不前进、`maxPages` / `maxItems`。**不要用 `total_number` 停止**，它包含楼中楼和不可见评论。

## `streamReplies(mblogId, rootCommentId, options?)`

```ts
for await (const reply of sdk.tweets.streamReplies('QqsYymYOS', rootCommentId)) {
  console.log(reply.id, reply.text)
}
```

与 `streamComments` 共享分页、去重、停止语义，固定 `fetchLevel: 1`。

## `getReposts(mblogId, options?)`

读取转发列表原始响应。分页用 `page`（`next_cursor` 参数无效）。

| 选项 | 类型 | 说明 |
|---|---|---|
| `page` | `number` | 页码 |
| `count` | `number` | 每页条数 |

## `streamReposts(mblogId, options?)`

```ts
for await (const repost of sdk.tweets.streamReposts('QqsYymYOS', { maxPages: 2 })) {
  console.log(repost.mblogId, repost.user.name)
}
```

选项：`page`、`count`、`maxPages`、`maxItems`、`since`、`until`、`onProgress`。

停止条件：空页、整页重复（`mblogId`）、达到 `total_number`、日期边界、上限。

## `likers(mblogId, options?)`

读取点赞者（`m.weibo.cn/api/attitudes/show`）：

```ts
const page = await sdk.tweets.likers('5355873276528697', { page: 1 })
page.likers
page.hasMore
page.total
```

- 上游只接受数字 mid；传 mblogId / URL 会自动用 `statuses/show` 解析一次。
- 网页端 `likeShow` 恒返回空数组，所以该能力标记为 `degraded`。
- `hasMore` 只能按空页 / `total` 估算。

## `streamLikers(mblogId, options?)`

```ts
for await (const liker of sdk.tweets.streamLikers('5355873276528697', { maxPages: 2 })) {
  console.log(liker.id, liker.name)
}
```

选项：`page`、`maxPages`、`maxItems`、`onProgress`。停止条件：空页、整页重复、达到 `total`、上限。

## CLI

```bash
weibo-cli tweet comments QqsYymYOS
weibo-cli tweet comments-stream QqsYymYOS --max-pages 3
weibo-cli tweet replies QqsYymYOS <rootCommentId>
weibo-cli tweet replies-stream QqsYymYOS <rootCommentId>
weibo-cli tweet reposts QqsYymYOS
weibo-cli tweet reposts-stream QqsYymYOS --max-pages 2
weibo-cli tweet likers 5355873276528697
weibo-cli tweet likers-stream 5355873276528697 --max-pages 2
```
