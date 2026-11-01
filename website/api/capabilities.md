---
title: 能力清单
description: 每项能力的鉴权要求、访客翻页范围、当前状态与 CLI 命令。
outline: deep
---

# 能力清单

`capabilities()` 是本地静态注册表。它说明每项能力是否存在、鉴权要求、访客翻页范围、数据归属与对应的 CLI 命令。

```ts
const caps = sdk.capabilities({ service: 'tweets' })
const guestOnly = sdk.capabilities({ status: 'degraded' })
```

## `WeiboCapability` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 能力 id，如 `tweets.comments`；前缀只是命名 |
| `service` | `string` | 门面属性名，方法真正挂在哪个服务上；门面自身为 `'sdk'` |
| `methods` | `string[]` | 对应的方法名，可直接在 `sdk[service]` 上取到 |
| `sdk` | `string` | 可直接运行的调用路径，如 `sdk.tweets.listByUserId(uid)` |
| `description` | `string` | 能力说明 |
| `auth` | `'cookie' \| 'guest' \| 'none'` | 最低鉴权要求；`guest` 表示访客可用 |
| `guestPagination` | `'none' \| 'first_page' \| 'full'` | 访客分页能力 |
| `guestNote` | `string?` | 访客限制说明 |
| `accountScoped` | `boolean?` | 只返回登录账号自身数据 |
| `pagination` | `'none' \| 'page' \| 'cursor' \| 'max_id' \| 'since_id' \| 'mixed'` | 分页类型 |
| `status` | `'stable' \| 'degraded' \| 'unavailable' \| 'planned'` | 当前状态 |
| `cli` | `string?` | 对应 CLI 命令 |
| `note` | `string?` | 已知限制 |

`id` 前缀是能力命名，`service` 才是方法所在的属性：`id` 为 `users.timeline` 的能力挂在 `sdk.tweets` 上。复制调用路径时用 `sdk` 字段。

```json
[
  {
    "id": "users.timeline",
    "service": "tweets",
    "methods": ["listByUserId", "streamByUserId"],
    "sdk": "sdk.tweets.listByUserId(uid)",
    "description": "用户微博列表（归一化）",
    "auth": "guest",
    "guestPagination": "first_page",
    "guestNote": "guest 模式仅返回 m 站第一页，标注 partial: true",
    "pagination": "page",
    "status": "stable",
    "cli": "weibo-cli user timeline <uid>"
  },
  {
    "id": "tweets.comments",
    "service": "tweets",
    "methods": ["comments", "streamComments"],
    "sdk": "sdk.tweets.comments(mblogId)",
    "description": "微博评论（含楼中楼内联回复）",
    "auth": "guest",
    "guestPagination": "full",
    "pagination": "max_id",
    "status": "stable",
    "cli": "weibo-cli tweet comments|comments-stream <mblogId>"
  }
]
```

## 如何判断可用性

```ts
function usableByGuest(cap: WeiboCapability) {
  return cap.auth === 'guest' && cap.status !== 'unavailable'
}

function canPaginateAsGuest(cap: WeiboCapability) {
  return cap.guestPagination === 'full'
}
```

`auth` 是最低要求；访客翻页范围看 `guestPagination`。访客可用且只能读第一页的能力有 `users.timeline`、`likes.list`、`followings.following`、`followings.fans`。

## 已知状态

| 状态 | 能力 | 说明 |
|---|---|---|
| `degraded` | `tweets.likers` | 网页端 `likeShow` 返回空数组，改用 m 站；入参需数字 mid |
| `unavailable` | `search.users`、`search.tweets` | 上游接口失效，调用返回 `API_BAD_RESPONSE` |

## CLI

```bash
weibo-cli capabilities
weibo-cli capabilities --status degraded
weibo-cli capabilities --service tweets
```
