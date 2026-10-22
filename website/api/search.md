---
title: search
outline: deep
---

# search

公开关键词搜索。**当前不可用**：上游接口失效，产品暂缓；调用会抛 `API_BAD_RESPONSE`。

| 方法 | 返回 | 分页 | 访客 | 稳定性 |
|---|---|---|---|---|
| `searchUsers(query, page?)` | `SearchUsersResponse` | `page` | 不可用 | 实验性 |
| `searchTweets(query, page?)` | `SearchTweetsResponse` | `page` | 不可用 | 实验性 |

## 状态

- `capabilities()` 中 `search.users` / `search.tweets` 的 `status` 为 `unavailable`。
- 上游返回的不是预期 JSON（登录页 / 空结构），SDK 抛 `UnexpectedAPIResponseError`（`API_BAD_RESPONSE`）。
- 个人主页内按日期搜索仍可用，见 [`tweets.searchByDate`](/api/tweets-timeline#searchbydate-uid-options)。

## 保留原因

方法签名与类型保留，便于未来上游恢复时无需改调用方代码。当前不建议在生产中依赖。
