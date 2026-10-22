---
title: 分页与流式读取
---

# 分页与流式读取

## 两种方法形态

| 前缀 | 行为 | 返回 |
|---|---|---|
| `list*` / `get*` | 只请求一页 / 一个实体 | 单页结果（含下一页游标） |
| `stream*` | 自动翻页，逐条产出 | `AsyncIterableIterator<T>` |

```ts
const page = await sdk.tweets.listByUserId('1111681197', { page: 1 })
console.log(page.tweets, page.page, page.hasMore)

for await (const tweet of sdk.tweets.streamByUserId('1111681197')) {
  console.log(tweet.mblogId)
}
```

## 游标类型

| 游标 | 端点 |
|---|---|
| `page` | 用户时间线（mymblog）、点赞、收藏、关注 / 粉丝、转发、点赞者、超话 |
| `maxId`（上游 `max_id`） | 评论、二级评论、历史评论、@ 我、通知、首页 Feed |
| `sinceId`（上游 `since_id`） | 图片墙 / 相册；首页 Feed 仅做增量过滤，不是翻页 |
| `cursor` | 视频瀑布 |

`listFriendTimeline` 用 `maxId` 翻旧页；`sinceId` 只返回比该微博更新的条目（单页）。

## 流式通用选项

所有 `stream*` 支持：

| 选项 | 说明 |
|---|---|
| `maxItems` | 最多产出条数（跨页去重后计数），达到后不再请求下一页 |
| `maxPages` | 最多翻页数；缺省不限 |
| `onProgress` | 每页回调；回调抛错不会中断流 |

时间倒序的流（用户时间线、首页 Feed、转发、@ 我、历史评论、评论 / 点赞通知）额外支持：

| 选项 | 说明 |
|---|---|
| `since` | 时间下界（`YYYY-MM-DD` 或 unix 秒），更早的条目停止翻页 |
| `until` | 时间上界，更晚的条目跳过 |

评论热度序、点赞、收藏不提供日期边界，因为条目顺序与操作时间不一致。

## 停止条件

流在任一条件命中时停止：

- 空页；
- 整页重复（上游忽略游标时的兜底）；
- 游标缺失 / 为 0 / 不前进；
- 达到 `total_number`（若该端点提供且语义可靠）；
- 达到 `maxItems` / `maxPages`；
- 命中 `since` / `until` 边界。

**注意**：

- 顶层评论的 `total_number` 包含楼中楼和不可见评论，不能当剩余条数；
- 首页 Feed 的 `total_number` 是约 2000 的上限值，不代表剩余条数；
- 访客身份下用户时间线 / 点赞 / 关注 / 粉丝只有第一页，结果带 `partial: true`。

## 进度回调

```ts
for await (const liker of sdk.tweets.streamLikers('5355873276528697', {
  maxPages: 2,
  onProgress: (progress) => {
    console.log(progress.page, progress.processed, progress.pageSize, progress.total)
  },
})) {
  console.log(liker.id, liker.name)
}
```

不同流的进度字段见各服务页面（`*StreamProgress`）。

## 去重

流式方法跨页按稳定 id 去重：

- 微博：`mblogId`
- 评论：`id`
- 点赞者 / 用户：用户 id
- 媒体：`asset.id`

如果消费端还要持久化，仍建议按同样 id 做幂等写入。
