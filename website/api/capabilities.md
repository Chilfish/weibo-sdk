---
title: 能力清单
outline: deep
---

# 能力清单

`capabilities()` 是离线静态注册表，不发起网络请求。用来回答：

- 这个能力是否存在；
- 需要 Cookie 还是访客可用；
- 访客能否翻页；
- 是否只返回登录账号自身的数据；
- 对应哪个 CLI 命令。

```ts
const caps = sdk.capabilities({ service: 'tweets' })
const guestOnly = sdk.capabilities({ status: 'degraded' })
```

## `WeiboCapability` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 稳定 id，如 `tweets.comments` |
| `service` | `string` | 门面属性名；门面自身为 `'sdk'` |
| `methods` | `string[]` | 对应的方法名，可直接在 `sdk[service]` 上取到 |
| `description` | `string` | 能力说明 |
| `auth` | `'cookie' \| 'guest' \| 'none'` | **最低鉴权要求**；`guest` 表示访客可用 |
| `guestPagination` | `'none' \| 'first_page' \| 'full'` | 访客分页能力 |
| `guestNote` | `string?` | 访客限制说明 |
| `accountScoped` | `boolean?` | 只返回登录账号自身数据 |
| `pagination` | `'none' \| 'page' \| 'cursor' \| 'max_id' \| 'since_id' \| 'mixed'` | 分页类型 |
| `status` | `'stable' \| 'degraded' \| 'unavailable' \| 'planned'` | 当前状态 |
| `cli` | `string?` | 对应 CLI 命令 |
| `note` | `string?` | 已知限制 |

## 如何判断可用性

```ts
function usableByGuest(cap: WeiboCapability) {
  return cap.auth === 'guest' && cap.status !== 'unavailable'
}

function canPaginateAsGuest(cap: WeiboCapability) {
  return cap.guestPagination === 'full'
}
```

不要只看 `auth === 'cookie'`：`auth` 是最低要求，`guestPagination` 才说明访客翻页范围。当前访客可用但只有第一页的能力：

- `users.timeline`
- `likes.list`
- `followings.following`
- `followings.fans`

## 已知状态

| 状态 | 能力 |
|---|---|
| `degraded` | `tweets.likers`（网页端 `likeShow` 为空，改用 m 站；入参需数字 mid） |
| `unavailable` | `search.users`、`search.tweets`（上游失效，产品暂缓） |

## CLI

```bash
weibo-cli capabilities
weibo-cli capabilities --status degraded
weibo-cli capabilities --service tweets
```
