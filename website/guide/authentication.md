---
title: 鉴权与访客模式
---

# 鉴权与访客模式

## `auth` 三态

| 配置 | 结果 |
|---|---|
| `cookie` + `auth` 缺省或 `'auto'` | Cookie |
| 无 `cookie` + `auth` 缺省或 `'auto'` | 访客 |
| 无 `cookie` + `auth: 'guest'` | 访客 |
| 有 `cookie` + `auth: 'guest'` | 访客（Cookie 被忽略） |
| 无 `cookie` + `auth: 'cookie'` | 构造时抛 `CONFIG_INVALID` |

`auto` 只在**构造时**判断一次：没有 Cookie 就用访客；**Cookie 过期不会静默降级**，会照常抛 `AUTH_SESSION_EXPIRED`。需要访客身份时显式传 `auth: 'guest'` 或 CLI 的 `--guest`。

```ts
const sdk = new WeiboSDK({ cookie })
const guest = new WeiboSDK({ auth: 'guest' })
const plain = new WeiboSDK({}) // 等价于 auto，没有 Cookie 就是访客
```

## Cookie 来源

`cookie` 接受三种值：

1. Cookie header 字符串：`SUB=...; SUBP=...; XSRF-TOKEN=...`
2. Netscape `cookies.txt` 文件路径
3. 包含 header 的文本文件路径（可带 `Cookie:` 前缀）

读取文件时只保留 `weibo.com`、`weibo.cn`、`sina.com.cn` 域，过期条目跳过；路径不存在或没有可用 Cookie 时抛 `InvalidConfigError`。

CLI **不读 shell 环境变量**，只读 `.env`：

```env
WEIBO_COOKIE="SUB=...; SUBP=...; XSRF-TOKEN=..."
```

```bash
weibo-cli whoami
weibo-cli whoami --guest      # 不读 .env
weibo-cli tweet detail QqsYymYOS --guest
```

## 访客 token

- 由 `visitor.passport.weibo.cn`（默认 `issuer: 'mobile'`）或桌面端点发放。
- 按 SDK 实例缓存，并发请求会合并。
- `autoRefresh` 默认开启，每个请求最多刷新一次。
- 不会输出明文 token；`getGuestTokenStatus()` 只给 `issuedAt` / `scope` / `source`。

```ts
await sdk.getGuestTokenStatus()
// { issuedAt: 1761..., scope: 'all', source: 'mobile' }
```

## 会话查询

```ts
const session = await sdk.getSession()
session.authMode       // 'cookie' | 'guest'
session.uid            // Cookie 模式下从 profile/detail 解析；访客为 undefined
session.checkedAt

await sdk.checkSession({ refresh: true }) // 永不抛错，返回 boolean
```

`getSession()` 复用启动自检的请求并做 single-flight；`refresh: true` 才会重新探测。

## 能力边界

`capabilities()` 是离线静态表，用来判断某个能力在访客下能不能用：

```ts
const caps = sdk.capabilities({ service: 'tweets' })
caps.forEach((cap) => {
  console.log(cap.id, cap.auth, cap.guestPagination, cap.status)
})
```

判断规则：

- `auth: 'guest'`：访客可用；`guestPagination` 说明能否翻页（`none` / `first_page` / `full`）。
- `auth: 'cookie'`：需要登录账号。
- `accountScoped: true`：只返回登录账号自身的数据，传其他 uid 也无效。

访客限制汇总见 [范围与限制](/guide/limitations)。
