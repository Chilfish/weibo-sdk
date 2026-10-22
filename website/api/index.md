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
| `fetchRaw*` | 低层数据源 | 原始上游响应（**实验性**） |

- 时间倒序的流支持 `since` / `until`；所有流支持 `maxItems` / `maxPages` / `onProgress`。
- 参数统一 camelCase；只有上游原始查询参数（例如 `searchByDate` 的 `starttime`）保留原样。
- 接受 `mblogId` 的方法同时接受数字 mid 与微博状态 URL，内部自动归一化。

## 稳定性徽章

每页的方法表带一列「稳定性」：

- **稳定**：受 SemVer 承诺。0.x 内破坏性变更会提供 `CHANGELOG` 迁移说明。
- **实验性**：可用，但返回原始上游形状或属于辅助函数；可能随上游漂移。
- **内部**：不从包根导出，本文不记录。

导出索引（含全部根导出）见 [导出索引](/api/types/)。

## 方法能回答什么

每个方法条目尽量给出：

1. 做什么、对应哪个上游端点；
2. 签名与参数（默认值、取值范围）；
3. 返回类型与关键字段；
4. 分页 / 停止条件 / 去重；
5. 访客可用性与账号级限制；
6. 可能抛出的错误码；
7. SDK 与 CLI 示例。

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

每个方法都在 CLI 有对应命令。SDK 页面里的示例通常同时给出 CLI 写法；完整命令、参数与输出形态见 [CLI 参考](/cli/)。
