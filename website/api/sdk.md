---
title: WeiboSDK 门面
outline: deep
---

# WeiboSDK 门面

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({ cookie })
```

默认配置下，构造阶段只解析配置并组装插件，首次请求或调用 `getSession()` 时执行自检；`selfCheck.mode: 'eager'` 时在构造阶段执行自检。

## 服务属性

| 属性 | 类型 | 页面 |
|---|---|---|
| `sdk.users` | `UserService` | [users](/api/users) |
| `sdk.tweets` | `TweetService` | [tweets](/api/tweets) |
| `sdk.followings` | `FollowingsService` | [followings](/api/followings) |
| `sdk.favorites` | `FavoriteService` | [favorites](/api/favorites) |
| `sdk.likes` | `LikeService` | [likes](/api/likes) |
| `sdk.commentHistory` | `CommentHistoryService` | [commentHistory](/api/comment-history) |
| `sdk.media` | `MediaService` | [media](/api/media) |
| `sdk.notifications` | `NotificationService` | [notifications](/api/notifications) |
| `sdk.topics` | `TopicService` | [topics](/api/topics) |
| `sdk.trends` | `TrendsService` | [trends](/api/trends) |
| `sdk.search` | `SearchService` | [search](/api/search) |
| `sdk.archive` | `ArchiveService` | [archive](/api/archive) |
| `sdk.userArchive` | `UserArchiveService` | [userArchive](/api/user-archive) |

## 构造配置 `IWeiboConfig`

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `cookie` | `string` | - | Cookie header、Netscape `cookies.txt` 路径，或包含 header 的文本文件；只保留 weibo 相关域 |
| `auth` | `'auto' \| 'cookie' \| 'guest'` | `'auto'` | 只在构造时判断；Cookie 失效时请求返回 `AUTH_SESSION_EXPIRED` |
| `guest` | `IWeiboGuestConfig` | - | `token`（预置访客 Cookie）、`issuer`（`'mobile' \| 'desktop' \| 'auto'`，默认 `'mobile'`）、`autoRefresh`（默认 true） |
| `xsrfToken` | `string` | - | 部分 POST 端点需要的 XSRF token |
| `proxy` | `string \| false \| IProxyProvider` | - | 静态代理 URL、动态 provider（返回 Promise 或 `false` 表示直连）、`false` 强制直连 |
| `timeout` | `number` | `30000` | 单请求超时毫秒 |
| `transport` | `WeiboTransport` | `axiosTransport()` | 自定义传输；`fetchTransport()` 用于 Worker / Edge / 测试 |
| `fetch` | `FetchLike` | `globalThis.fetch` | 访客 token 发放使用的 fetch；主传输默认用 axios |
| `plugins` | `WeiboPlugin[]` | - | 构造期组装，`apiVersion: 1`，名称唯一 |
| `burst` | `number` | `3` | 令牌桶容量：同一瞬间的最大突发请求数，也是实际并发上限 |
| `delay` | `number` | `1000` | 令牌补充间隔毫秒；持续吞吐由它决定 |
| `retry` | `IWeiboRetryConfig` | 见下 | `retries`（2，上限 10）、`baseDelayMs`（500）、`maxDelayMs`（8000）、`retryOn` |
| `hooks` | `WeiboSDKHooks` | - | `onLifecycle` / `onRaw` / `onError` |
| `telemetry` | `WeiboSDKTelemetry` | - | Wide Events sink；sink 抛出的错误被忽略 |
| `logger` | `WeiboLogger` | 关闭 | 结构化日志 sink；内置 console / JSONL |
| `selfCheck` | `{ mode?: 'none' \| 'lazy' \| 'eager' }` | `'lazy'` | 启动自检模式 |

```ts
new WeiboSDK({ auth: 'guest' })                 // 显式访客，忽略 Cookie
new WeiboSDK({ auth: 'cookie', cookie })        // 没有 Cookie 时构造即抛 CONFIG_INVALID
new WeiboSDK({ transport: fetchTransport() })   // Worker / Edge
```

## 会话与自检

### `selfCheck(): Promise<void>`

触发一次 `ajax/profile/detail` 会话检查。`selfCheck.mode` 为 `'eager'` 时在构造阶段调用。失败时抛结构化错误；可重试的失败在下次请求时重新探测。

### `getSession(options?: SessionOptions): Promise<WeiboSessionContext>`

```ts
const session = await sdk.getSession({ refresh: true })
session.authMode   // 'cookie' | 'guest'
session.uid        // Cookie 模式下解析出的 uid；访客为 undefined
session.checkedAt
session.details    // raw profile/detail（访客缺省）
session.guestTokenIssuedAt?
```

- 复用启动自检的请求，按实例 single-flight 缓存。
- 传 `refresh: true` 重新探测。

### `checkSession(options?: SessionOptions): Promise<boolean>`

共享 `getSession` 的缓存，返回 boolean，失败时为 `false`。

### `authMode: 'cookie' | 'guest'`

只读 getter，反映构造时的鉴权模式。

### `getGuestTokenStatus(): Promise<{ issuedAt, scope, source } | undefined>`

返回访客 token 的元信息（`issuedAt` / `scope` / `source`）。Cookie 模式下返回 `undefined`。

## 能力发现

### `capabilities(filter?: CapabilityFilter): WeiboCapability[]`

离线静态表，不发网络请求：

```ts
sdk.capabilities({ service: 'tweets' })
sdk.capabilities({ status: 'degraded' })
```

字段与判断方式见 [能力清单](/api/capabilities)。
