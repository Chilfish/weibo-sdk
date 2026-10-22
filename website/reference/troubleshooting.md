---
title: 故障排查
outline: deep
---

# 错误排障手册

SDK 抛出的错误都带 `code`，排查时判断 `error.code`，再看 `error.context`。`message` 来自上游响应，会随上游文案变化。

## 错误分类速查

| code | 类 | level | 可重试 | 含义 |
|------|----|-------|--------|------|
| `CONFIG_INVALID` | `InvalidConfigError` | business | 否 | Cookie 为空或 Cookie 文件不可用 |
| `AUTH_SESSION_EXPIRED` | `WeiboSessionExpiredError` | business | 否 | Cookie 过期或无效 |
| `API_NOT_OK` | `WeiboAPINotOkError` | business | 否 | 微博接口返回 `ok !== 1` |
| `API_BAD_RESPONSE` | `UnexpectedAPIResponseError` | protocol | 否 | Zod 校验失败，或响应不是 JSON（登录页、风控页、接口下线） |
| `NET_TIMEOUT` | `ConnectionTimeoutError` | transport | 是 | 请求超时 |
| `NET_REQUEST_FAILED` | `NetworkRequestError` | transport | 是 | 网络错误（含 4xx / 5xx） |
| `RATE_LIMITED` | `RateLimitError` | transport | 是 | 微博限流或风控（HTTP 432 / 429） |
| `MEDIA_DOWNLOAD_FAILED` | `MediaDownloadError` | transport | 是 | 媒体 CDN 5xx、429、408、超时、连接失败、空闲超时、响应截断或 0 字节 |
| `MEDIA_BAD_RESPONSE` | `MediaInvalidResponseError` | protocol | 否 | 返回 HTML / JSON、类型不匹配、超过大小上限或非法重定向 |
| `MEDIA_STORAGE_FAILED` | `MediaStorageError` | storage | 否 | mkdir、write、rename 或 unlink 失败 |

## CONFIG_INVALID

含义：构造 `WeiboSDK` 时没有提供 Cookie，或传入的 Cookie 无法解析；访客模式下的参数越界也报这个码。

触发场景：

```typescript
// 以下抛出 InvalidConfigError:
// new WeiboSDK({ auth: 'cookie' })                     // 显式要求 Cookie 但没提供
// new WeiboSDK({ cookie: './missing-cookies.txt' })   // 路径不存在
// new WeiboSDK({ cookie: './other-site.cookies.txt' }) // 文件里没有微博域名 Cookie
// new WeiboSDK({ auth: 'guest', guest: { token: 'SUBP=x' } }) // 预置 token 缺 SUB=
```

访客模式下请求第 2 页（`page > 1`）或调用归档，同样报 `CONFIG_INVALID`，`context` 里带 `guestPagination: 'first_page'` 或 `field: 'archive'`。

诊断步骤：

- 检查 `.env` 文件中的 `WEIBO_COOKIE` 是否已设置；使用访客身份时改用 `auth: 'auto'` / `auth: 'guest'` / CLI `--guest`。
- 确认 Cookie 字符串非空，并包含 `SUB=` 字段。
- 值为文件路径时，确认路径存在且可读（相对路径按 pwd 解析）。Netscape 文件需要是 7 列 TSV，并包含 `weibo.com` / `weibo.cn` / `sina.com.cn` 域名的 Cookie，其他站点的条目会被忽略。`error.context.path` 给出实际读取的文件路径。

## AUTH_SESSION_EXPIRED

含义：Cookie 已过期或无效。SDK 在调用 `myDetails()` 时检测到 `ok ≠ 1`。

触发场景：

- `new WeiboSDK({ cookie })` 后的首次请求（lazy 模式）或构造时（eager 模式）
- 手动调用 `sdk.selfCheck()`

诊断步骤：

1. 检查 hooks.onError 事件：
   ```
   event_name: 'request_error'
   phase: 'response'
   ok: 0
   message: 'need login'
   ```
2. 确认 Cookie 中的 `SUB=` 值是否仍然有效（在浏览器中打开 weibo.com 验证）
3. 重新获取有效的 Cookie 并替换 `.env` 中的值
4. CLI 读取 `.env`（默认 `<pwd>/.env`，`--env-file` 可指定）。`whoami` 报错时会打印实际读取路径，先确认路径正确

访客模式下同类错误的几类表现见下文「访客模式排障」。

Hook 示例：

```typescript
void new WeiboSDK({
  cookie: '...',
  hooks: {
    onError: (_error, meta) => {
      if (meta.ok === 0)
        console.error('Session expired, need new cookie')
    },
  },
})
```

## API_NOT_OK

含义：微博 API 返回了 `ok ≠ 1`（通常是 `0`），表示请求参数错误或资源不可访问。

触发场景：

- 对不存在的用户 ID 调用 `users.getById()`（底层 `ajax/profile/info` / `detail`）
- 对不存在的微博 ID 调用 `tweets.getByMblogId()` 或 `tweets.enrich()`
- 不满足 endpoint 特定条件（如需要特殊 Cookie 权限）

诊断步骤：

1. 查看 hooks.onError 中的 `ok` 和 `message` 字段：
   ```
   event_name: 'request_error'
   phase: 'response'
   endpoint: 'ajax/profile/info'
   ok: 0
   message: 'user not found'
   ```
2. 确认传入的 uid/mblogId 是否存在

与 `AUTH_SESSION_EXPIRED` 的区分：

- `AUTH_SESSION_EXPIRED` 只在 `myDetails()`（无参数自检）时触发
- `API_NOT_OK` 覆盖其他所有 `ok ≠ 1` 的场景

## API_BAD_RESPONSE

含义：微博 API 返回了数据，但结构不符合 Zod schema 定义；或响应本身不是 JSON（HTML 登录页、风控页）。

触发场景：

- 微博 API 字段变更（新增、删除或类型变更）
- `retweeted_status` 嵌套结构异常，例如 user 为 null、ok 缺失
- 响应是 HTML。例如 m.weibo.cn 的搜索接口返回登录页 HTML，微博已移除公开的 JSON 搜索 API。此时 `context.raw` 是截断的 HTML（前 200 字符），`zodIssues` 为空

诊断步骤：

1. 先看 `context.raw`。出现 `<!doctype html>`、`<title>登录</title>` 之类片段时，端点返回了登录页或挑战页，常见原因是 Cookie 失效、接口被风控，或微博移除了该接口，按对应路径继续排查。
2. `context.raw` 是 JSON 时，查看 `error.context.zodIssues`（Zod 校验失败详情），例如：
   ```json
   [
     {
       "code": "invalid_type",
       "expected": "number",
       "received": "undefined",
       "path": ["retweeted_status", "ok"],
       "message": "Invalid input: expected number, received undefined"
     }
   ]
   ```
3. `path` 字段指向出错的字段路径。
4. 保存失败响应的原始 JSON，连同 `zodIssues` 一起反馈给维护者。

维护者处理时，把真实响应加入测试样本，更新对应 endpoint 的 Zod schema，并同步更新快照。

## NET_TIMEOUT

含义：HTTP 请求超时（默认 30 秒）。

触发场景：

- 微博服务器响应慢
- 网络连接不稳定
- 代理配置问题

诊断步骤：

1. 检查 telemetry 事件中的 `duration_ms`
2. 增加 `config.timeout`：`new WeiboSDK({ cookie, timeout: 60000 })`
3. 确认代理设置正确

重试：`retryable: true`。SDK 默认按指数退避重试，调用方也可以自行实现退避。

## NET_REQUEST_FAILED

含义：HTTP 请求失败，属于超时之外的网络错误。

触发场景：

- 微博服务器返回 404（端点 URL 错误）
- 微博服务器返回 5xx（服务器内部错误）
- DNS 解析失败
- 代理不可达

诊断步骤：

1. 检查 `error.context.status`（HTTP 状态码）
2. 检查 `error.context.data`（响应体）
3. Telemetry 事件中查看 `url` 和 `method`

重试：`retryable: true`。SDK 对 5xx 和无响应的连接类失败做指数退避重试，配置见 `config.retry`；4xx（404、403 等）直接返回错误。

## RATE_LIMITED

含义：微博对当前 Cookie 或 IP 触发风控或限流，通常是 HTTP 432（微博风控页）或 429（Too Many Requests）。

触发场景：

- 短时间大量归档或翻页请求（`streamArchive`、`streamFavorites`、连续详情请求）
- 同一 Cookie 在网页端与 SDK 同时高频访问
- 出口 IP 被判定为异常（共享代理、机房 IP）

诊断步骤：

1. 查看 `error.context`：
   ```json
   { "status": 432, "retryAfterMs": 30000, "attempt": 3, "message": "..." }
   ```
   - `status`：432 / 429
   - `retryAfterMs`：上游 `Retry-After`（秒或 HTTP date）解析后的毫秒数，缺失时退化为指数退避
   - `attempt`：该错误是第几次尝试（`1` 表示首次请求）
2. 查看 telemetry：`request_retry` 记录每次退避（`attempt` / `delay_ms` / `reason` / `status`），`request_error`（`error_code: 'RATE_LIMITED'`）记录终态失败
3. 检查 `rate_limit_wait` 事件的 `reason`：`rate_limited` 表示令牌桶正在全局暂停，其他并发请求已经排队

处理：

- 降低并发：`maxConcurrent: 1`、拉长 `delay`（例如 `delay: 3000`）
- 加大退避：调高 `retry.retries` 与 `maxDelayMs`
- 换用浏览器同 IP 的 Cookie 或网络；长时间 432 说明风控已生效，暂停归档数小时
- 命中 432 后 SDK 自动暂停全局令牌桶（`RateLimitService.pause`），并发请求依次排队

重试：`retryable: true`，默认按指数退避加 jitter 自动重试，见下节。

## 重试策略

`FetcherService` 对可重试的结构化错误做指数退避加 jitter。默认最大重试次数 2（不含首次请求），基础延迟 500ms，单次延迟上限 8000ms。

第 n 次重试的延迟约为 `min(maxDelayMs, baseDelayMs * 2^(n-1))`，再乘以 `0.5` 到 `1.0` 之间的 jitter。上游返回 `Retry-After` 时直接采用该值，同样受 `maxDelayMs` 截断，不再叠加 jitter。

每次退避发出 `request_retry` 事件，包含 `attempt`、`max_attempts`、`delay_ms`、`reason`、`status`。最终失败才发 `request_error`，hooks 的 `onError` 也只在最终失败时触发。

完整的 retry 配置项与示例见 [错误与重试](/guide/errors-retries)。

## 媒体下载错误（`MEDIA_*`）

- `MEDIA_DOWNLOAD_FAILED`：CDN 传输层失败。检查 `context.status` 和 `reason`，这类错误可以重试。遇到 403、404、410 时，下载器先尝试刷新微博 URL。
- `MEDIA_BAD_RESPONSE`：响应不是媒体文件，常见于 `text/html` 的登录页或风控页；也可能是类型不匹配或超过 `maxBytes`。查看 `context.contentType` 和 `snippet`。
- `MEDIA_STORAGE_FAILED`：本地落盘失败，比如 `ENOSPC`、`EACCES` 或 `EPERM`。换一个输出目录或释放空间；下载器会停止后续调度。
- 失败清单写在 `<out>/<mblogId>-media-errors.json`。详细规则见 [媒体下载](./media-download)。

## 访客模式排障

没有 Cookie 时 SDK 使用访客身份（`auth: 'auto'` 的默认行为），CLI 对应 `--guest`。访客身份可读的范围比登录态小，这一节的错误都由权限范围引起。

### `AUTH_SESSION_EXPIRED` 且 `context.requiredAuth === 'cookie'`

含义：这个端点只接受登录 Cookie，SDK 在发出请求之前就拒绝。

- 典型能力：收藏与收藏标签、评论通知、点赞通知、@ 我、历史评论、我的关注、首页关注时间线、个人主页日期搜索、微博分组。
- 处理：重试会得到同样的结果。提供 Cookie（`.env` 的 `WEIBO_COOKIE`、`--cookie` 或 `config.cookie`），或改用访客可读的替代能力，例如用 `tweet detail` 加 `tweet comments` 代替时间线归档。
- 排查：运行 `weibo-cli capabilities --service <name> | jq '.[] | {id, auth, guestPagination}'`，`auth: 'cookie'` 的条目就是这一类。

### 访客 token 发放失败

`AUTH_SESSION_EXPIRED`，`context.reason = 'guest_token_issue'`，带 `step`（`genvisitor` / `incarnate` / `genvisitor2`），可能还有 `status` 和截断的 `body`。

- 常见原因：`visitor.passport.weibo.cn` 临时不可用、被风控，或出口网络拿不到响应。
- 处理：稍后重试。环境有全局 `fetch` 限制（Node < 18 或受限沙箱）时会以 `reason: 'fetch_unavailable'` 报错，需要升级运行时。
- 复用外部已发放的访客 Cookie：`new WeiboSDK({ auth: 'guest', guest: { token: 'SUB=...; SUBP=...' } })`。token 必须含 `SUB=`，否则报 `CONFIG_INVALID`。
- 诊断输出使用 `sdk.getGuestTokenStatus()` 或 `weibo-cli whoami --guest`，只显示 `issuedAt` / `scope` / `source`。

### 432 / 429 时保持访客 token

访客模式下 432 / 429 仍然映射为 `RATE_LIMITED`，SDK 按 `config.retry` 退避并暂停令牌桶，访客 token 保持不变：限流与身份无关，换 token 会再次命中限流。事件里的 `guest_refresh_count` 保持 `0`。

处理方式与 Cookie 模式相同：降低并发（`maxConcurrent: 1`）、拉长 `delay`，或停一段时间。

### guest 端点返回空对象 `{}`

部分端点被匿名请求时返回 `200` 和空对象 `{}`，实际是登录门控。SDK 对 guest 端点单独判定：`{}` 抛 `AUTH_SESSION_EXPIRED`，`context.authFailureReason = 'empty_object'`，随后自动刷新一次 token 重试；仍然失败才把错误抛给调用方。

持续失败说明该端点已收紧为必须登录。把它的 `auth` 从 `guest` 改回 `cookie`，并在 `capabilities.ts` 更新 `guestNote`。

### 只有第一页，或者 `CONFIG_INVALID`

访客只能读 m 站容器第一页（用户时间线、点赞、关注、粉丝），匿名请求第 2 页会被重定向到登录页。表现是：

- 返回结果带 `partial: true`、`hasMore: false`，没有 `page`；关注 / 粉丝的 `next_cursor` 为 `0`。
- 显式请求 `page: 2` 抛 `CONFIG_INVALID`，`context.field = 'page'`、`guestPagination: 'first_page'`。
- `archive` 在访客模式下直接抛 `CONFIG_INVALID`，`field: 'archive'`，因为归档需要完整时间线。

需要完整数据时提供 Cookie；访客身份适合详情、评论、媒体这类单点读取。

## 使用 hooks 集中诊断

```typescript
const errors: Array<{ error: unknown, meta: any }> = []

const sdk = new WeiboSDK({
  cookie: process.env.WEIBO_COOKIE!,
  hooks: {
    onError: (error, meta) => {
      errors.push({ error, meta })
    },
  },
  telemetry: {
    emit: (event) => {
      if (event.event_name === 'request_error') {
        console.error('[WeiboSDK]', event.phase, event.endpoint, event.error_code)
      }
    },
  },
})

await sdk.users.getById('123456')
if (errors.length > 0) {
  const last = errors[errors.length - 1]
  console.error('Last error:', last.meta.phase, last.meta.endpoint)
}
```

## 诊断决策树

```
请求失败
├─ error.code === 'CONFIG_INVALID'
│  ├─ Cookie 是文件路径 → 检查路径存在、可读、含微博域名 Cookie
│  ├─ context.field === 'page' / 'archive' 且带 guest 标记 → 访客只读第一页，归档需要 Cookie
│  └─ 其他情况 → 检查 Cookie 是否非空（显式 auth: 'cookie' 时必填）
├─ error.code === 'AUTH_SESSION_EXPIRED'
│  ├─ context.requiredAuth === 'cookie' → 该能力只读登录账号，访客不可用，换 Cookie
│  ├─ context.reason === 'guest_token_issue' → 访客 token 发放失败，稍后重试或预置 guest.token
│  └─ 其他情况 → 更换 Cookie（浏览器重新获取）
├─ error.code === 'API_NOT_OK'
│  ├─ ok === 0 && message 含 'not found'
│  │  └─ 检查 uid/mblogId 是否存在
│  └─ ok === 0 && message 含 'login'
│     └─ 更换 Cookie
├─ error.code === 'API_BAD_RESPONSE'
│  ├─ 查看 zodIssues 定位字段
│  ├─ 保留原始响应样本
│  └─ 反馈给维护者更新 schema 与快照
├─ error.code === 'NET_TIMEOUT'
│  └─ 增加 timeout 或检查代理（默认已自动退避重试）
├─ error.code === 'RATE_LIMITED'（432 / 429）
│  ├─ 看 request_retry 事件的 attempt / delay_ms 是否已耗尽 retries
│  ├─ 降低 maxConcurrent / 拉长 delay，或加大 retry 退避
│  └─ 持续 432 → 停一段时间（风控生效），必要时换出口 IP / Cookie
└─ error.code === 'NET_REQUEST_FAILED'
   ├─ status 4xx → 检查 URL（直接返回错误）
   └─ status 5xx → 延迟重试（默认已自动退避重试）
```
