---
title: 鉴权与访客模式
---

# 鉴权与访客模式

## `auth` 三种取值

| 配置 | 结果 |
|---|---|
| `cookie` + `auth` 缺省或 `'auto'` | Cookie |
| 无 `cookie` + `auth` 缺省或 `'auto'` | 访客 |
| 无 `cookie` + `auth: 'guest'` | 访客 |
| 有 `cookie` + `auth: 'guest'` | 访客（Cookie 被忽略） |
| 无 `cookie` + `auth: 'cookie'` | 构造时抛 `CONFIG_INVALID` |

`auth` 在构造时确定。Cookie 过期后，请求返回 `AUTH_SESSION_EXPIRED`；需要访客身份时显式传 `auth: 'guest'` 或 CLI 的 `--guest`。

```ts
const sdk = new WeiboSDK({ cookie })
const guest = new WeiboSDK({ auth: 'guest' })
const plain = new WeiboSDK({}) // 等价于 auto：没有 Cookie 就是访客
```

## Cookie 来源

`cookie` 接受三种值：

1. Cookie header 字符串：`SUB=...; SUBP=...; XSRF-TOKEN=...`
2. Netscape `cookies.txt` 文件路径
3. 包含 header 的文本文件路径（可带 `Cookie:` 前缀）

读取文件时保留 `weibo.com`、`weibo.cn`、`sina.com.cn` 域的条目，过期条目跳过；路径不存在或没有可用 Cookie 时抛 `InvalidConfigError`。

CLI 读取 `.env`（默认当前目录，`--env-file` 可指定）：

```env
WEIBO_COOKIE="SUB=...; SUBP=...; XSRF-TOKEN=..."
```

```bash
weibo-cli whoami
weibo-cli whoami --guest      # 忽略 .env
weibo-cli tweet detail QqsYymYOS --guest
```

## 访客 token

- 由 `visitor.passport.weibo.cn`（默认 `issuer: 'mobile'`）或桌面端点发放。
- 按 SDK 实例缓存，并发请求会合并。
- `autoRefresh` 默认开启，每个请求最多刷新一次。
- `getGuestTokenStatus()` 返回 `issuedAt` / `scope` / `source`；token 明文保存在 SDK 内部。

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

await sdk.checkSession({ refresh: true }) // 返回 boolean
```

`getSession()` 复用启动自检的请求，按实例做 single-flight；`refresh: true` 时重新探测。`checkSession()` 返回布尔值，会话不可用时为 `false`。

## 能力边界

`capabilities()` 是离线静态表，用于判断某个能力在访客身份下是否可用：

```ts
const caps = sdk.capabilities({ service: 'tweets' })
caps.forEach((cap) => {
  console.log(cap.id, cap.auth, cap.guestPagination, cap.status)
})
```

- `auth: 'guest'`：访客可用；`guestPagination` 说明翻页范围（`none` / `first_page` / `full`）。
- `auth: 'cookie'`：需要登录账号。
- `accountScoped: true`：只返回登录账号自身的数据。

访客限制汇总见 [范围与限制](/guide/limitations)。
