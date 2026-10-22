---
title: likes
outline: deep
---

# likes

「我赞过的微博」。按目标 uid 读取，不属于账号级能力；访客只返回第一页。

| 方法 | 返回 | 分页 | 访客 | 稳定性 |
|---|---|---|---|---|
| `listByUserId(uid, options?)` | `LikePageResult` | `page` | 第一页 | 稳定 |
| `streamByUserId(uid, options?)` | `ITweet` 流 | `page` | 第一页 | 稳定 |

## `listByUserId(uid, options?)`

| 选项 | 类型 | 说明 |
|---|---|---|
| `page` | `number` | 页码；`< 1` / 非有限数按第一页，不会发 `page=0` |

返回：

```ts
interface LikePageResult {
  page: number        // 下一页页码
  hasMore: boolean    // 本页去重后是否有条目；越界页为 false
  tweets: ITweet[]
  partial?: boolean   // guest 模式为 true，hasMore 恒为 false
}
```

上游 `likelist` 只返回 `data.list`，没有 total / cursor，因此 `hasMore` 只能按本页是否为空判断。

## `streamByUserId(uid, options?)`

```ts
for await (const tweet of sdk.likes.streamByUserId('7679065628', {
  maxPages: 3,
  maxItems: 100,
})) {
  console.log(tweet.mblogId, tweet.text)
}
```

选项：`page`、`maxPages`、`maxItems`、`onProgress`。

停止条件：空页、整页重复（按 `mblogId`）、`maxPages` / `maxItems`。

## 访客边界

访客只返回 m 站第一页，结果带 `partial: true`，请求 `page: 2` 会抛 `CONFIG_INVALID`。

## CLI

```bash
weibo-cli like list 7679065628
weibo-cli like stream 7679065628 --max-pages 3
```
