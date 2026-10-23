---
title: trends
outline: deep
---

# trends

热搜、话题与文娱榜单。

| 方法 | 返回 | 分页 |
|---|---|---|
| `hotBand(type?)` | `BandUnifiedResponse` | 无 |

访客可读取三个榜单，边界见 [范围与限制](/guide/limitations)。

## `hotBand(type = 'hot')`

```ts
const hot = await sdk.trends.hotBand('hot')
const topic = await sdk.trends.hotBand('topic')
const entertainment = await sdk.trends.hotBand('entertainment')
```

| 参数 | 取值 | 说明 |
|---|---|---|
| `type` | `'hot' \| 'topic' \| 'entertainment'` | 默认 `'hot'` |

返回上游原始响应，字段未归一化。

## CLI

```bash
weibo-cli trends
weibo-cli trends --type entertainment
```
