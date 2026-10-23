---
title: 原始响应
outline: deep
---

# 原始响应

公开读取方法统一返回归一化后的 camelCase 领域模型。需要上游原始响应时，使用显式的 `fetchRaw*` 方法：它们返回与微博接口同形的 snake_case 数据。

原始响应类型不从包根导出，字段随上游漂移。应用代码优先使用归一化方法；`fetchRaw*` 适合排障、落盘 raw 和 schema 快照。

## `fetchRaw*` 方法

| 方法 | 对应端点 |
|---|---|
| `users.fetchRawInfo` / `users.fetchRawDetails` / `users.fetchRawMyDetails` | 用户资料 |
| `tweets.fetchRawUserTimelinePage` | `ajax/statuses/mymblog` |
| `tweets.fetchRawComments` / `tweets.fetchRawReplies` | `ajax/statuses/buildComments` |
| `tweets.fetchRawReposts` | `ajax/statuses/repostTimeline` |
| `tweets.fetchRawLongText` | `ajax/statuses/longtext` |
| `tweets.fetchRawSearchByDate` | `ajax/statuses/searchProfile` |
| `followings.fetchRawFollowings` / `fetchRawFans` / `fetchRawMyFollowings` | 关注 / 粉丝 |
| `favorites.fetchRawFavorites` / `fetchRawTags` | 收藏夹 |
| `trends.fetchRawBand` | 热搜榜 |
| `search.fetchRawSearchUsers` / `fetchRawSearchTweets` | 公开搜索（不可用） |
| `likes.fetchRawPage` | 点赞列表 |
| `commentHistory.fetchRawPage` | 我的历史评论 |
| `media.fetchRawImagePage` / `fetchRawVideoPage` | 图片墙 / 视频瀑布 |

所有端点、归档流与传输层都支持 `config.hooks.onRaw`，用于在不改变返回类型的前提下旁路保存 raw。

把原始对象转成领域模型的归一化函数属于仓库内部实现，不从包根导出；应用代码应直接使用归一化方法。

完整名单见 [导出索引](/api/types/)。
