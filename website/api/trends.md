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
hot[0].realpos   // 展示位次（1 基）
hot[0].heat
```

| 参数 | 取值 | 说明 |
|---|---|---|
| `type` | `'hot' \| 'topic' \| 'entertainment'` | 默认 `'hot'` |

```ts
interface TrendItem {
  word: string
  realpos?: number    // 1 基展示位次（上游 realpos）
  rank?: number       // 0 基下标（上游 rank，语义未完全确认）
  heat?: number       // 上游 num
  category?: string
  label?: string      // 上游 label_name
  icon?: string       // 上游 icon_desc
  flag?: number
  schemeUrl?: string  // 上游 word_scheme
}
```

热榜有置顶与并列，数组下标与展示名次对不上：展示名次用 `realpos`，CLI 的 Markdown 输出已经按 `realpos` 编号。`word` 为空的条目会被跳过。需要完整上游响应时用 `fetchRawBand(type)`。

## CLI

```bash
weibo-cli trends
weibo-cli trends --type entertainment
```
