---
title: trends
outline: deep
---

# trends

热搜、话题与文娱榜单。

| 方法 | 返回 | 分页 |
|---|---|---|
| `hotBand(type?)` | `TrendItem[]` | 无 |
| `fetchRawBand(type?)` | `BandUnifiedResponse` | 无 |

访客可读取三个榜单，边界见 [范围与限制](/guide/limitations)。

## `hotBand(type = 'hot')`

```ts
const hot = await sdk.trends.hotBand('hot')
const topic = await sdk.trends.hotBand('topic')
const entertainment = await sdk.trends.hotBand('entertainment')

hot[0].word
hot[0].heat
```

| 参数 | 取值 | 说明 |
|---|---|---|
| `type` | `'hot' \| 'topic' \| 'entertainment'` | 默认 `'hot'` |

```ts
interface TrendItem {
  word: string
  heat?: number       // 上游 num
  category?: string
  label?: string      // 上游 label_name
  icon?: string       // 上游 icon_desc
  flag?: number
  schemeUrl?: string  // 上游 word_scheme
}
```

`word` 为空的条目会被跳过。需要完整上游响应时用 `fetchRawBand(type)`。

## CLI

```bash
weibo-cli trends
weibo-cli trends --type entertainment
```
