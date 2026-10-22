---
title: trends
outline: deep
---

# trends

热搜 / 话题 / 文娱榜单。

| 方法 | 返回 | 分页 | 访客 | 稳定性 |
|---|---|---|---|---|
| `hotBand(type?)` | `BandUnifiedResponse` | — | 可用 | 实验性 |

## `hotBand(type = 'hot')`

```ts
const hot = await sdk.trends.hotBand('hot')
const topic = await sdk.trends.hotBand('topic')
const entertainment = await sdk.trends.hotBand('entertainment')
```

| 参数 | 取值 | 说明 |
|---|---|---|
| `type` | `'hot' \| 'topic' \| 'entertainment'` | 默认 `'hot'` |

返回上游原始响应（实验性），字段未归一化；需要稳定字段时请自行映射并接受上游漂移风险。

## CLI

```bash
weibo-cli trends
weibo-cli trends --type entertainment
```
