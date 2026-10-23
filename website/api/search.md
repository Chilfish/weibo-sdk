---
title: search
outline: deep
---

# search

公开关键词搜索。当前不可用，调用返回 `API_BAD_RESPONSE`。

| 方法 | 返回 | 分页 |
|---|---|---|
| `searchUsers(query, page?)` | `SearchUsersResponse` | `page` |
| `searchTweets(query, page?)` | `SearchTweetsResponse` | `page` |

## 状态

- `capabilities()` 中 `search.users` / `search.tweets` 的 `status` 为 `unavailable`。
- 上游返回登录页或空结构，SDK 抛 `UnexpectedAPIResponseError`（`API_BAD_RESPONSE`）。
- 访客与 Cookie 调用结果一致，边界见 [范围与限制](/guide/limitations)。

按日期搜索用个人主页入口：`tweets.searchByDate`，见 [tweets / timeline](/api/tweets-timeline#searchbydate-uid-options)。
