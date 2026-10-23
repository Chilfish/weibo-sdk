---
title: 如何阅读 API 参考
outline: deep
---

# 如何阅读 API 参考

## 命名约定

| 前缀 | 含义 | 返回 |
|---|---|---|
| `get*` | 读取单个实体 | 领域模型（`ITweet` / `IUser` / …） |
| `list*` | 读取一页 | `*PageResult`，带下一页游标 |
| `stream*` | 自动翻页 | `AsyncIterableIterator<T>` |
| `fetchRaw*` | 低层数据源 | 返回上游原始响应 |

- 时间倒序的流支持 `since` / `until`；所有流支持 `maxItems` / `maxPages` / `onProgress`。
- 参数统一 camelCase；上游原始查询参数（例如 `searchByDate` 的 `starttime`）沿用原样。
- 接受 `mblogId` 的方法同时接受数字 mid 与微博状态 URL，内部自动归一化。

导出索引（含全部根导出）见 [导出索引](/api/types/)。

## 方法条目内容

每个方法条目包含对应的上游端点、签名与默认值、返回类型、分页与停止条件、访客可用性、错误码，以及 SDK 与 CLI 示例。

## 按服务查找

| 服务 | 页面 | 主要能力 |
|---|---|---|
| `users` | [users](/api/users) | 用户资料、@ 我、关注 / 微博分组 |
| `tweets` | [单条](/api/tweets) · [时间线](/api/tweets-timeline) · [互动](/api/tweets-engagement) | 详情、上下文、时间线、评论、转发、点赞者 |
| `followings` | [followings](/api/followings) | 关注 / 粉丝 / 我的关注 |
| `favorites` | [favorites](/api/favorites) | 收藏夹与标签 |
| `likes` | [likes](/api/likes) | 我赞过的微博 |
| `commentHistory` | [commentHistory](/api/comment-history) | 历史评论 |
| `media` | [media](/api/media) | 图片墙 / 视频 / 相册 / 下载 |
| `notifications` | [notifications](/api/notifications) | 评论 / 点赞通知 |
| `topics` | [topics](/api/topics) | 超话分类 / 列表 |
| `trends` | [trends](/api/trends) | 热搜 / 话题 / 文娱榜 |
| `search` | [search](/api/search) | 公开关键词搜索（当前不可用） |
| `archive` | [archive](/api/archive) | 全量镜像流、多账号、增量 |
| `userArchive` | [userArchive](/api/user-archive) | 时间段归档与深度补全 |

## 与 CLI 的对应

每个方法在 CLI 都有一个对应命令。SDK 页面的示例同时给出 CLI 写法；完整命令、参数与输出形态见 [CLI 参考](/cli/)。
