---
title: topics
outline: deep
---

# topics

超话分类、列表与关键词搜索。

| 方法 | 返回 | 分页 |
|---|---|---|
| `cates()` | `SuperTopicCategory[]` | 无 |
| `list(options?)` | `SuperTopicPageResult` | `page` |
| `stream(options?)` | `SuperTopic` 流 | `page` |

访客可读取分类与列表并完整分页，边界见 [范围与限制](/guide/limitations)。

## `cates()`

读取超话分类（`/ajax/stopic/cates`）：

```ts
const cates = await sdk.topics.cates()
// [{ id: 1, name: '最近使用' }, ...]
```

`id` 可作为 `list({ sortId })` 的分类参数。

## `list(options?)`

| 选项 | 类型 | 说明 |
|---|---|---|
| `sortId` | `number` | 分类 id；与 `keyword` 同传时上游忽略分类 |
| `keyword` | `string` | 关键词搜索（非空时按关键词） |
| `page` | `number` | 页码，从 1 开始 |

返回 `{ page, hasMore, totalPages?, topics: SuperTopic[] }`，当前页结果按 `pageId` 去重。

## `stream(options?)`

```ts
for await (const topic of sdk.topics.stream({ keyword: '游戏', maxPages: 3 })) {
  console.log(topic.pageId, topic.title)
}
```

选项：`sortId`、`keyword`、`page`、`maxPages`、`maxItems`、`onProgress`。

停止条件：空页、整页重复、达到 `totalPages`、`maxPages` / `maxItems`。

## 类型

- `SuperTopicCategory`：`{ id, name }`
- `SuperTopic`：`{ pageId, title, description?, coverUrl?, icon?, isCircle }`

## CLI

```bash
weibo-cli topic cates
weibo-cli topic list --sort-id 1
weibo-cli topic stream --keyword 游戏 --max-pages 2
```
