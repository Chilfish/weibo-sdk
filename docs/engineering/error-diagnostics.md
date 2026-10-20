# 错误排障手册

本手册覆盖 `weibo-sdk` 所有已知错误类型及其诊断流程。每种错误均包含：含义、触发条件、诊断步骤、示例日志。

---

## 错误分类速查

| code | 类 | level | 可重试 | 含义 |
|------|----|-------|--------|------|
| `CONFIG_INVALID` | `InvalidConfigError` | business | ❌ | Cookie 为空 / Cookie 文件不可用 |
| `AUTH_SESSION_EXPIRED` | `WeiboSessionExpiredError` | business | ❌ | Cookie 过期/无效 |
| `API_NOT_OK` | `WeiboAPINotOkError` | business | ❌ | API 返回 ok ≠ 1 |
| `API_BAD_RESPONSE` | `UnexpectedAPIResponseError` | protocol | ❌ | Zod schema 校验失败 / 响应非 JSON（登录页/风控页/接口移除） |
| `NET_TIMEOUT` | `ConnectionTimeoutError` | transport | ✅ | 请求超时 |
| `NET_REQUEST_FAILED` | `NetworkRequestError` | transport | ✅ | 网络错误（含 4xx/5xx） |
| `RATE_LIMITED` | `RateLimitError` | transport | ✅ | 上游限流/风控（HTTP 432 / 429） |

---

## 1. CONFIG_INVALID

**含义**：构造 `WeiboSDK` 时未提供 Cookie，或传入的 Cookie 文件无法解析。

**触发**：
```typescript
// 以下抛出 InvalidConfigError:
// new WeiboSDK({ cookie: '' })
// new WeiboSDK({ cookie: './missing-cookies.txt' })   // 路径不存在
// new WeiboSDK({ cookie: './other-site.cookies.txt' }) // 文件里没有微博域名 Cookie
```

**诊断**：
- 检查 `.env` 文件中的 `WEIBO_COOKIE` 是否已设置
- 确认 Cookie 字符串非空、包含 `SUB=` 字段
- 如果值是文件路径：确认路径存在且可读（相对路径按 pwd 解析）；Netscape 文件需为 7 列 TSV，并包含 `weibo.com` / `weibo.cn` / `sina.com.cn` 域名的 Cookie（其他站点会被忽略）。`error.context.path` 会给出实际读取的文件路径

---

## 2. AUTH_SESSION_EXPIRED

**含义**：Cookie 已过期或无效。SDK 在调用 `myDetails()` 时检测到 `ok ≠ 1`。

**触发**：
- `new WeiboSDK({ cookie })` 后首次请求（lazy 模式）或构造时（eager 模式）
- 手动调用 `sdk.selfCheck()`

**诊断**：
1. 检查 hooks.onError 事件：
   ```
   event_name: 'request_error'
   phase: 'response'
   ok: 0
   message: 'need login'
   ```
2. 确认 Cookie 中的 `SUB=` 值是否仍然有效（在浏览器中打开 weibo.com 验证）
3. 重新获取有效的 Cookie 并替换 `.env` 中的值
4. CLI 只读 `.env`（默认 `<pwd>/.env`，`--env-file` 可指定），不读取 `WEIBO_COOKIE` 环境变量；`whoami` 报错时会打印实际读取路径，先确认路径正确

**hook 示例**：
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

---

## 3. API_NOT_OK

**含义**：微博 API 返回了 `ok ≠ 1`（通常是 `0`），表示请求参数错误或资源不可访问。

**触发**：
- 对不存在的用户 ID 调用 `users.info()` / `users.details()`
- 对不存在的微博 ID 调用 `tweets.show()`
- 不满足 endpoint 特定条件（如需要特殊 Cookie 权限）

**诊断**：
1. 查看 hooks.onError 中的 `ok` 和 `message` 字段：
   ```
   event_name: 'request_error'
   phase: 'response'
   endpoint: 'ajax/profile/info'
   ok: 0
   message: 'user not found'
   ```
2. 确认传入的 uid/mblogId 是否存在

**与 AUTH_SESSION_EXPIRED 的区分**：
- `AUTH_SESSION_EXPIRED` 仅在 `myDetails()`（无参数自检）时触发
- `API_NOT_OK` 在其他所有 ok ≠ 1 的场景触发

---

## 4. API_BAD_RESPONSE

**含义**：微博 API 返回了数据，但结构不符合 Zod schema 定义；或响应根本不是 JSON（HTML 登录页/风控页）。

**触发**：
- 微博 API 字段变更（新增/删除/类型变更）
- `retweeted_status` 嵌套结构异常（如 user 为 null、ok 缺失）
- 响应为 HTML 而非 JSON：**端点失效/风控**（如 m.weibo.cn 搜索接口 2026-08 起返回登录页 HTML，微博已移除公开 JSON 搜索 API）——此时 `context.raw` 为截断的 HTML（前 200 字符），`zodIssues` 为空

**诊断**：
1. 先看 `context.raw`：若为 `<!doctype html>`/`<title>登录</title>` 等 HTML 片段，说明端点返回了登录页/挑战页——通常是 **Cookie 失效、接口被风控、或上游移除该接口**，按对应排查路径处理（见 §5 会话失效 / backlog 已知问题）。
2. 若 `context.raw` 为 JSON，查看 `error.context.zodIssues`（Zod 校验失败详情），例如：
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
3. `path` 字段指向出错的字段路径
4. 用真实数据运行 E2E 快照测试 (`pnpm test:e2e`) 来捕获完整的响应结构

**修复流程**：
1. 保存失败响应的原始 JSON 到 `tests/fixtures/raw/`
2. 更新对应 endpoint 的 Zod schema（`src/services/endpoints/<domain>.ts`）
3. 运行 `pnpm test:e2e --update` 更新快照
4. 运行 `pnpm test` 确认所有离线测试通过

---

## 5. NET_TIMEOUT

**含义**：HTTP 请求超时（默认 30 秒）。

**触发**：
- 微博服务器响应慢
- 网络连接不稳定
- 代理配置问题

**诊断**：
1. 检查 telemetry 事件中的 `duration_ms`
2. 尝试增加 `config.timeout`：`new WeiboSDK({ cookie, timeout: 60000 })`
3. 确认代理设置正确

**重试**：此错误 `retryable: true`，可实现指数退避重试。

---

## 6. NET_REQUEST_FAILED

**含义**：HTTP 请求失败（非超时类网络错误）。

**触发**：
- 微博服务器返回 404（端点 URL 错误）
- 微博服务器返回 5xx（服务器内部错误）
- DNS 解析失败
- 代理不可达

**诊断**：
1. 检查 `error.context.status`（HTTP 状态码）
2. 检查 `error.context.data`（响应体）
3. Telemetry 事件中查看 `url` 和 `method`

**重试**：`retryable: true`，SDK 默认对 **5xx** 与**无响应**的连接类失败做指数退避重试（`config.retry`）；其余 4xx（404/403…）不重试。

---

## 7. RATE_LIMITED

**含义**：微博对当前 Cookie/IP 触发风控或限流——HTTP **432**（微博风控页）或 **429**（Too Many Requests）。

**触发**：
- 短时间大量归档/翻页请求（`streamArchive`、`streamFavorites`、连续详情请求）
- 同一 Cookie 在网页端与 SDK 同时高频访问
- 出口 IP 被判定为异常（共享代理、机房 IP）

**诊断**：
1. 查看 `error.context`：
   ```json
   { "status": 432, "retryAfterMs": 30000, "attempt": 3, "message": "..." }
   ```
   - `status`：432 / 429
   - `retryAfterMs`：上游 `Retry-After`（秒或 HTTP date）解析后的毫秒数，缺失则退化为指数退避
   - `attempt`：该错误是第几次尝试（`1` = 首次请求）
2. 查看 telemetry：`request_retry` 记录每次退避（`attempt` / `delay_ms` / `reason` / `status`），`request_error`（`error_code: 'RATE_LIMITED'`）记录终态失败
3. 检查 `rate_limit_wait` 事件的 `reason`：`rate_limited` 表示令牌桶正在全局暂停（其他并发请求已被拦住）

**处置**：
- 降低并发：`maxConcurrent: 1`、拉长 `delay`（例如 `delay: 3000`）
- 加大退避：`retry: { retries: 3, baseDelayMs: 2000, maxDelayMs: 30000 }`
- 换用浏览器同 IP 的 Cookie/网络；长时间 432 说明风控已生效，应暂停归档数小时
- 432 命中后 SDK 会自动暂停全局令牌桶（`RateLimitService.pause`），避免并发请求同时撞墙

**重试**：`retryable: true`，默认按指数退避 + jitter 自动重试（见 §8）。

---

## 8. 重试策略（config.retry）

`FetcherService` 对**可重试**的结构化错误做指数退避 + jitter，全部可选、向后兼容：

```typescript
const sdk = new WeiboSDK({
  cookie: '...',
  retry: {
    retries: 2,           // 最大重试次数（不含首次请求；0 = 不重试），默认 2，硬上限 10
    baseDelayMs: 500,     // 首次重试基础延迟，默认 500ms
    maxDelayMs: 8000,     // 单次延迟上限，默认 8000ms
    retryOn: ['rate_limit', 'server_error', 'timeout', 'network_error'], // 默认全部
  },
})
```

| 类别 | 触发错误 | 默认重试 |
|------|----------|----------|
| `rate_limit` | `RATE_LIMITED`（432/429） | ✅ |
| `server_error` | `NET_REQUEST_FAILED` 且 `status >= 500` | ✅ |
| `timeout` | `NET_TIMEOUT` | ✅ |
| `network_error` | `NET_REQUEST_FAILED` 且无 `status`（DNS/连接重置） | ✅ |

**不重试**：其余 4xx（404/403…）、`API_NOT_OK`（`ok != 1`）、`API_BAD_RESPONSE`（schema/非 JSON）、`CONFIG_INVALID`、`AUTH_SESSION_EXPIRED`——即使配置了 `retries` 也不会重发。

**延迟算法**：第 n 次重试 ≈ `min(maxDelayMs, baseDelayMs * 2^(n-1))`，再乘 jitter 系数 `0.5 ~ 1.0`；若上游给出 `Retry-After`，直接采用其值（同样受 `maxDelayMs` 截断，不做 jitter）。

**可观测性**：每次退避发 `request_retry`（`attempt` / `max_attempts` / `delay_ms` / `reason` / `status` / `error_*`）；终态失败才发 `request_error`（`attempt` = 总尝试次数），hooks `onError` 同样只在终态触发（避免重试期间刷屏）。

---

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

---

## 诊断决策树

```
请求失败
├─ error.code === 'CONFIG_INVALID'
│  ├─ Cookie 是文件路径 → 检查路径存在、可读、含微博域名 Cookie
│  └─ 否则检查 Cookie 是否非空
├─ error.code === 'AUTH_SESSION_EXPIRED'
│  └─ 更换 Cookie（浏览器重新获取）
├─ error.code === 'API_NOT_OK'
│  ├─ ok === 0 && message 含 'not found'
│  │  └─ 检查 uid/mblogId 是否存在
│  └─ ok === 0 && message 含 'login'
│     └─ 更换 Cookie
├─ error.code === 'API_BAD_RESPONSE'
│  ├─ 查看 zodIssues 定位字段
│  ├─ 用 E2E 抓取真实响应
│  └─ 更新 Schema + 快照
├─ error.code === 'NET_TIMEOUT'
│  └─ 增加 timeout 或检查代理（默认已自动退避重试）
├─ error.code === 'RATE_LIMITED'（432 / 429）
│  ├─ 看 request_retry 事件的 attempt / delay_ms 是否已耗尽 retries
│  ├─ 降低 maxConcurrent / 拉长 delay，或加大 retry 退避
│  └─ 持续 432 → 停一段时间（风控生效），必要时换出口 IP / Cookie
└─ error.code === 'NET_REQUEST_FAILED'
   ├─ status 4xx → 检查 URL（不重试）
   └─ status 5xx → 延迟重试（默认已自动退避重试）
```
