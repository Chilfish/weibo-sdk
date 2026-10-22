---
title: favorites
outline: deep
---

# favorites

收藏夹。上游 `all_fav` 忽略 uid，始终返回登录账号的收藏；属于账号级能力，访客不可用。

| 方法 | 返回 | 分页 | 访客 | 稳定性 |
|---|---|---|---|---|
| `getFavorites(uid, page?)` | `FavoritesResponse` | `page` | 不可用 | 实验性 |
| `listFavorites(uid, options?)` | `FavoritePageResult` | `page` | 不可用 | 稳定 |
| `streamFavorites(uid, options?)` | `ITweet` 流 | `page` | 不可用 | 稳定 |
| `getTags()` | `FavoritesTagsResponse` | — | 不可用 | 实验性 |

## `getFavorites(uid, page?)`

原始收藏响应。`page < 1` 会归一到 1，避免上游 400。

## `listFavorites(uid, options?)`

归一化一页收藏，支持客户端标签过滤：

| 选项 | 类型 | 说明 |
|---|---|---|
| `page` | `number` | 页码，`< 1` 按第一页 |
| `tag` | `string \| number` | 按标签 id 或名称精确匹配（基于收藏项自带 `tags`） |

返回：

```ts
interface FavoritePageResult {
  page: number          // 下一页页码
  hasMore: boolean      // 优先用 total_page，其次 total_number 估算
  total?: number
  totalPages?: number
  tweets: ITweet[]      // 已按 mblogId 去重，并应用 tag 过滤
}
```

## `streamFavorites(uid, options?)`

```ts
for await (const tweet of sdk.favorites.streamFavorites(uid, {
  tag: '技术',
  maxPages: 3,
  onProgress: progress => console.log(progress.page, progress.processed, progress.matched),
})) {
  console.log(tweet.mblogId, tweet.text)
}
```

选项：`page`、`tag`、`maxPages`、`maxItems`、`onProgress`。

停止条件：空页、整页重复、`hasMore === false`、`maxPages` / `maxItems`。标签过滤在客户端完成，`processed` 是过滤后的产出数，`pageSize` / `matched` 用于观察每页命中情况。

## `getTags()`

读取收藏标签清单。元素结构上游尚未稳定，按实验性处理。

## 错误与边界

- 访客调用抛 `AUTH_SESSION_EXPIRED`（`context.requiredAuth = 'cookie'`）。
- 归档其他 uid 时，`includeFavorites` 会抛 `CONFIG_INVALID`，因为数据始终属于登录账号。
- `getFavorites` / `getTags` 返回原始形状，实验性。

## CLI

```bash
weibo-cli favorite list 1111681197
weibo-cli favorite stream 1111681197 --max-pages 2
weibo-cli favorite tags
```
