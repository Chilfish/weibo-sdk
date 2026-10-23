---
title: tweets（单条）
outline: deep
---

# tweets（单条）

单条微博的详情、raw、长文与 Agent 视角上下文。

| 方法 | 返回 | 访客 |
|---|---|---|
| `getByMblogId(mblogId, isGetLongText?)` | `ITweet` | 可用 |
| `enrich(mblogId, options?)` | `TweetEnrichResult` | 可用 |
| `context(mblogId, options?)` | `ITweetContext` | 可用 |
| `longText(mblogId)` | `LongtextResponse` | 可用 |

访客可读取单条微博，边界见 [访客限制](/guide/limitations)。

## `getByMblogId(mblogId, isGetLongText = true)`

```ts
const tweet = await sdk.tweets.getByMblogId('QqsYymYOS')
// 也接受数字 mid 与状态 URL
await sdk.tweets.getByMblogId('5356120103455672')
await sdk.tweets.getByMblogId('https://m.weibo.cn/status/5356120103455672')
```

- 内部请求 `statuses/show`；`isGetLongText` 默认 true，长文全文落在 `tweet.text`。
- 返回 `ITweet`；字段契约见 [ITweet 契约](/reference/tweet-contract)。
- 错误：`API_NOT_OK`（不存在 / 被删）、`API_BAD_RESPONSE`、传输层错误。

## `enrich(mblogId, options?)`

同时返回 raw 与归一化模型：

| 选项 | 默认 | 说明 |
|---|---|---|
| `isGetLongText` | true | `statuses/show` 的 `isGetLongText` |
| `includeLongText` | false | 额外请求 `longtext` 补拉全文 |

```ts
const { tweet, raw, longText } = await sdk.tweets.enrich('QqsYymYOS', {
  includeLongText: true,
})
```

返回 `TweetEnrichResult`：`tweet` 与 `getByMblogId` 同构；`raw` 保留未映射字段；`longText` 仅在开关打开时有值。

## `context(mblogId, options?)`

构造 Agent 视角的单条微博上下文（`weibo.tweet-context/v1`）。默认只请求 `statuses/show`，按开关追加：

| 选项 | 默认 | 说明 |
|---|---|---|
| `author` | true | 补作者资料（+1 请求） |
| `comments` | 0 | 抽样评论条数 |
| `commentFlow` | `'hot'` | `'hot'` / `'time'` |
| `longText` | true | `isLongText` 时补全文 |
| `maxChars` | 不限 | 单个文本字段字符上限 |
| `maxMedia` | 全部 | 最多列出的媒体数 |
| `includeQuoted` | true | 展开转发的原微博（一层） |
| `includeRepostChain` | true | 展开转发链 |
| `now` | 当前时间 | 测试注入的毫秒时间戳 |
| `authMode` | - | 仅用于 provenance |

```ts
const context = await sdk.tweets.context('QqsYymYOS', { comments: 5, maxChars: 4000 })
context.post.text        // 当前作者本人发言
context.quoted?.media    // 转发的原微博媒体
context.unknowns         // 图片未描述 / 视频未转写 / 评论为抽样等
```

上下文只包含抓取到的事实；OCR、视觉描述、视频转写由调用方补充。

- 时间序评论需要数字 mid，方法内部自动解析。
- 返回结构见 [微博上下文](/api/types/tweet-context)。

## `longText(mblogId)`

返回上游 `ajax/statuses/longtext` 原始响应，含 `data.longTextContent` 与 `data.longTextContent_raw`。`enrich` / `context` 在需要全文时自动拉取，通常直接使用这两个方法即可。

## CLI

```bash
weibo-cli tweet detail QqsYymYOS
weibo-cli tweet detail QqsYymYOS --format markdown
weibo-cli tweet context QqsYymYOS --comments 5
weibo-cli tweet context QqsYymYOS --download-media ./weibo-media
weibo-cli tweet enrich QqsYymYOS
weibo-cli tweet longtext QqsYymYOS
```
