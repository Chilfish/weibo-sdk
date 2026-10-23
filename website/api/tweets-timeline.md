---
title: tweets（时间线）
outline: deep
---

# tweets（时间线）

用户时间线、首页关注时间线、日期检索与原始页。

| 方法 | 返回 | 分页 | 访客 |
|---|---|---|---|
| `fetchRawUserTimelinePage(uid, page?, count?)` | `MyMblogResponse` | `page` | 第一页 |
| `listByUserId(uid, options?)` | `TweetPageResult` | `page` | 第一页 |
| `streamByUserId(uid, options?)` | `ITweet` 流 | `page` | 第一页 |
| `listFriendTimeline(options?)` | `TweetPageResult` | `maxId` | 需 Cookie |
| `streamFriendTimeline(options?)` | `ITweet` 流 | `maxId` | 需 Cookie |
| `searchByDate(uid, options?)` | `SearchProfileResponse` | `page` | 需 Cookie |

访客只拿到 m 站第一页，`page > 1` 抛 `CONFIG_INVALID`；首页时间线与日期检索需要 Cookie。详见 [访客限制](/guide/limitations)。

## `fetchRawUserTimelinePage(uid, page?, count?)`

拉取 `mymblog` 原始页，返回上游原始响应；需要归一化字段时用 `listByUserId` / `streamByUserId`。归档层用它生成 `schemaDigest`。

## `listByUserId(uid, options?)`

| 选项 | 类型 | 说明 |
|---|---|---|
| `page` | `number` | 页码，缺省 1 |
| `count` | `number` | 每页条数，缺省由上游决定 |

返回 `TweetPageResult`：

```ts
interface TweetPageResult {
  page?: number       // 下一页页码（page 游标端点）
  maxId?: string      // 下一页游标（max_id 游标端点）
  hasMore: boolean
  total?: number
  partial?: boolean   // guest 第一页
  tweets: ITweet[]
}
```

广告（`isAd`）会被过滤；`hasMore` 依据过滤后的内容判断。

## `streamByUserId(uid, options?)`

```ts
for await (const tweet of sdk.tweets.streamByUserId('1111681197', {
  page: 1,
  count: 20,
  maxPages: 5,
  maxItems: 100,
  since: '2026-01-01',
  until: '2026-03-31',
})) {
  console.log(tweet.mblogId, tweet.createdAt)
}
```

翻页依赖 `hasMore`；停止条件为无更多、空页、日期边界、`maxPages` / `maxItems`。中途失败直接抛错；需要断点续传请用 [归档](/api/archive)。

## `listFriendTimeline(options?)`

首页「最新微博」关注时间线，单页：

| 选项 | 类型 | 说明 |
|---|---|---|
| `maxId` | `string \| number` | 翻旧页游标（上一页 `maxId`） |
| `sinceId` | `string \| number` | 只取比该微博更新的条目（单页增量） |
| `listId` | `string \| number` | 关注分组 id |
| `fid` | `string \| number` | 分组过滤参数 |
| `count` | `number` | 上游实测忽略 |
| `refresh` | `number` | 刷新标记，透传 |

`hasMore` 依据「本页非空 + 游标存在且前进」判断；`total_number` 是约 2000 的上限值，与剩余条数无关。

## `streamFriendTimeline(options?)`

```ts
for await (const tweet of sdk.tweets.streamFriendTimeline({ maxPages: 3 })) {
  console.log(tweet.mblogId)
}

// 增量：只请求一页
for await (const tweet of sdk.tweets.streamFriendTimeline({ sinceId: lastSeenId })) {
  console.log(tweet.mblogId)
}
```

停止条件：空页、整页重复、游标不前进、日期边界、`maxPages` / `maxItems`。

## `searchByDate(uid, options?)`

个人主页内按日期/关键词检索（`searchProfile`），返回上游原始响应：

| 选项 | 类型 | 说明 |
|---|---|---|
| `page` | `number` | 页码 |
| `q` | `string` | 关键词 |
| `starttime` / `endtime` | `number \| string` | unix 秒，或 `YYYY-MM-DD` / `YYYYMMDD`（本地时区，含当天） |
| `hasori` / `hasret` / `hastext` / `haspic` / `hasvideo` / `hasmusic` | `0 \| 1` | 过滤位，语义未经上游文档确认 |

非法日期抛 `CONFIG_INVALID`。`data.total` 可能是 `number | string`，调用方自行解析。

> 上游行为：`page > 1` 会复用最近一次 `page=1` 的日期窗口，并发请求不同区间会互相覆盖。归档层因此串行枚举日期切片。

## CLI

```bash
weibo-cli user timeline 1111681197
weibo-cli user timeline-stream 1111681197 --max-pages 2
weibo-cli tweet home
weibo-cli tweet home --max-id <上一页 maxId>
weibo-cli tweet home --since-id <微博数字 id>
weibo-cli tweet home-stream --max-pages 3
weibo-cli tweet search-profile 1111681197 --since 2026-01-01 --until 2026-03-31
```
