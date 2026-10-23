---
title: favorites
outline: deep
---

# favorites

收藏夹。上游 `all_fav` 固定返回登录账号的收藏，与传入的 uid 无关。

| 方法 | 返回 | 分页 | 访客 |
|---|---|---|---|
| `getFavorites(uid, page?)` | `FavoritesResponse` | `page` | 不可用 |
| `listFavorites(uid, options?)` | `FavoritePageResult` | `page` | 不可用 |
| `streamFavorites(uid, options?)` | `ITweet` 流 | `page` | 不可用 |
| `getTags()` | `FavoritesTagsResponse` | - | 不可用 |

访客调用抛 `AUTH_SESSION_EXPIRED`（`context.requiredAuth = 'cookie'`）。详见 [访客限制](/guide/limitations)。

## `getFavorites(uid, page?)`

返回上游原始响应；需要归一化字段时用 `listFavorites`。`page < 1` 归一到 1，避免上游 400。

## `listFavorites(uid, options?)`

归一化一页收藏，支持客户端标签过滤：

| 选项 | 类型 | 说明 |
|---|---|---|
| `page` | `number` | 页码，`< 1` 归一到 1 |
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

返回上游收藏标签清单的原始响应；元素结构跟随上游。

## 错误与边界

- 归档其他 uid 时，`includeFavorites` 会抛 `CONFIG_INVALID`，数据始终属于登录账号。

## CLI

```bash
weibo-cli favorite list 1111681197
weibo-cli favorite stream 1111681197 --max-pages 2
weibo-cli favorite tags
```
