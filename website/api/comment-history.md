---
title: commentHistory
outline: deep
---

# commentHistory

当前登录账号的历史评论。上游 `myCmt` 不接受 uid，属于账号级能力；访客不可用。

| 方法 | 返回 | 分页 | 访客 | 稳定性 |
|---|---|---|---|---|
| `listMine(options?)` | `CommentHistoryPageResult` | `maxId` / `page` | 不可用 | 稳定 |
| `streamMine(options?)` | `ITweetComment` 流 | `maxId` | 不可用 | 稳定 |

## `listMine(options?)`

| 选项 | 类型 | 说明 |
|---|---|---|
| `maxId` | `number \| string` | 上一页的 `cursor`；数字字符串自动转 number，优先于 `page` |
| `page` | `number` | 页码，未给 `maxId` 时生效 |

返回：

```ts
interface CommentHistoryPageResult {
  cursor: number              // next_cursor；0 表示到底
  hasMore: boolean
  total?: number
  comments: ITweetComment[]   // 已按评论 id 去重
}
```

## `streamMine(options?)`

```ts
for await (const comment of sdk.commentHistory.streamMine({
  maxPages: 3,
  since: '2026-01-01',
})) {
  console.log(comment.id, comment.text, comment.parentMblogId)
}
```

选项：`maxId`、`page`、`maxPages`、`maxItems`、`since`、`until`、`onProgress`。

停止条件：`next_cursor === 0`、空页、游标不前进、整页重复、日期边界、上限。

## 错误与边界

- 访客调用抛 `AUTH_SESSION_EXPIRED`（`context.requiredAuth = 'cookie'`）。
- 归档其他 uid 时，`includeCommentHistory` 会抛 `CONFIG_INVALID`。
- 返回的评论里 `parentMblogId` 指向被评论微博（若上游内嵌了 `status`）。

## CLI

```bash
weibo-cli comment mine
weibo-cli comment stream --max-pages 3
```
