# 错误排障手册

本手册覆盖 `weibo-sdk` 所有已知错误类型及其诊断流程。每种错误均包含：含义、触发条件、诊断步骤、示例日志。

---

## 错误分类速查

| code | 类 | level | 可重试 | 含义 |
|------|----|-------|--------|------|
| `CONFIG_INVALID` | `InvalidConfigError` | business | ❌ | Cookie 为空 |
| `AUTH_SESSION_EXPIRED` | `WeiboSessionExpiredError` | business | ❌ | Cookie 过期/无效 |
| `API_NOT_OK` | `WeiboAPINotOkError` | business | ❌ | API 返回 ok ≠ 1 |
| `API_BAD_RESPONSE` | `UnexpectedAPIResponseError` | protocol | ❌ | Zod schema 校验失败 |
| `NET_TIMEOUT` | `ConnectionTimeoutError` | transport | ✅ | 请求超时 |
| `NET_REQUEST_FAILED` | `NetworkRequestError` | transport | ✅ | 网络错误（含 404/5xx） |

---

## 1. CONFIG_INVALID

**含义**：构造 `WeiboSDK` 时未提供 Cookie。

**触发**：
```typescript
// 以下抛出 InvalidConfigError:
// new WeiboSDK({ cookie: '' })
```

**诊断**：
- 检查 `.env` 文件中的 `WEIBO_COOKIE` 是否已设置
- 确认 Cookie 字符串非空、包含 `SUB=` 字段

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

**hook 示例**：
```typescript
void new WeiboSDK({
  cookie: '...',
  hooks: {
    onError: (_error, meta) => {
      if (meta.ok === 0) console.error('Session expired, need new cookie')
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

**含义**：微博 API 返回了数据，但结构不符合 Zod schema 定义。

**触发**：
- 微博 API 字段变更（新增/删除/类型变更）
- `retweeted_status` 嵌套结构异常（如 user 为 null、ok 缺失）

**诊断**：
1. 查看 `error.context.zodIssues`（Zod 校验失败详情）：
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
2. `path` 字段指向出错的字段路径
3. 用真实数据运行 E2E 快照测试 (`pnpm test:e2e`) 来捕获完整的响应结构

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

**重试**：此错误 `retryable: true`，5xx 可延迟重试，4xx 不应重试。

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
│  └─ 检查 Cookie 是否非空
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
│  └─ 增加 timeout 或检查代理
└─ error.code === 'NET_REQUEST_FAILED'
   ├─ status 4xx → 检查 URL
   └─ status 5xx → 延迟重试
```
