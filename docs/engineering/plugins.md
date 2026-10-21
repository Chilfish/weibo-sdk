# 插件与传输适配

> **目标**：在不改变默认路径（`new WeiboSDK({})`）的前提下，提供可替换的 HTTP 传输、凭证解析端口与构造期插件管线。
> **实现**：`src/services/internal/transport/**`、`src/services/internal/plugins/**`、`src/services/internal/CredentialResolver.ts`。
> **相关**：[todo-plugin-architecture.md](../planning/todo-plugin-architecture.md)、[research-plugin-architecture-2026-10-21.md](../planning/research-plugin-architecture-2026-10-21.md)、ADR-014 / ADR-015。

---

## 1. 三层结构

```
WeiboSDK（门面）
 ├─ Ports（构造注入）
 │   ├─ WeiboTransport      AxiosTransport（默认）/ FetchTransport / 自定义
 │   ├─ CredentialResolver  SingleCredentialResolver（默认，不做池）
 │   └─ Clock               测试可注入 FakeClock
 ├─ Core 状态机（不插件化）
 │   ├─ EndpointSpec.auth
 │   ├─ retry / rate-limit / auth-refresh
 │   ├─ okPolicy
 │   └─ Zod 校验
 └─ Plugins（构造期组装一次）
     ├─ lifecycle hooks  beforeRequest / afterResponse / beforeRetry / onError
     ├─ transport        cache / mock / circuit breaker / signing
     └─ observe          日志 / 指标（只读，异常吞掉）
```

**核心状态机不插件化**：retry / rate-limit / auth-refresh 的先后顺序是正确性的一部分，不能交给用户配置。

---

## 2. 传输端口

```ts
interface WeiboTransport {
  send: (request: TransportRequest) => Promise<TransportResponse>
}
```

契约：

- 所有 HTTP 状态码都作为正常响应返回；只有网络 / 超时抛 `TransportFailure`。
- `redirect: 'manual'` 必须把 3xx 原样返回（guest 登录页 / visitor 入口判定依赖它）。
- 不修改传入的 request；header 名统一小写。
- HTTP 语义（432 / 429 / 403 / 3xx / 登录页 / `Retry-After`）由 `FetcherService` 分类，不在 transport 内。

默认使用 `AxiosTransport`。切换原生 fetch：

```ts
import { WeiboSDK, fetchTransport } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({
  // Worker / Edge / Deno / Bun / 测试替身
  transport: fetchTransport(),
})

// 注入自定义 fetch（与 guest token 发放共用）
const sdk2 = new WeiboSDK({
  fetch: myFetch,
  transport: fetchTransport({ fetch: myFetch }),
})
```

`config.fetch` 供 `GuestTokenService` 发放访客 token 使用；只注入 `fetch` 不改变默认 transport（仍是 axios），主请求要用 fetch 必须显式传 `transport`。

自定义 transport 示例：

```ts
const mockTransport = {
  async send(request) {
    return { status: 200, headers: {}, data: { ok: 1, data: {} } }
  },
}

new WeiboSDK({ transport: mockTransport })
```

---

## 3. 凭证端口

```ts
interface Credential {
  id: string                    // 非敏感标识，进 telemetry / 错误 context
  mode: 'cookie' | 'guest' | 'none'
  getHeaders(): Promise<Record<string, string>>
  refresh?(reason: AuthFailureReason): Promise<boolean>
}

interface CredentialResolver {
  resolve(ctx: { endpoint, auth, attempt, traceId }): Credential | Promise<Credential>
  report?(ctx: { credential, outcome, error? }): void
}
```

- 默认 `SingleCredentialResolver`：所有非 `none` 端点使用同一份主凭证。
- **不做 token 池**。账号级端点轮换会改变数据语义；guest 池受 IP 风控限制（见 ADR-015）。
- `credential_id` 只包含 Cookie 指纹 / `guest-primary` / `none`，不包含 Cookie 明文。
- guest 模式下 cookie-only 端点仍在发请求前以 `AUTH_SESSION_EXPIRED` 拒绝。

---

## 4. 插件 API

```ts
interface WeiboPlugin {
  name: string                 // 唯一；重名 → CONFIG_INVALID
  apiVersion: 1                // 当前只接受 1
  enforce?: 'pre' | 'normal' | 'post'

  transport?: (next: WeiboTransport) => WeiboTransport

  hooks?: {
    beforeRequest?: (ctx: RequestContext) => void | Promise<void>
    afterResponse?: (ctx: ResponseContext) => void | Promise<void>
    beforeRetry?: (ctx: RetryContext) => void | BeforeRetryResult | Promise<void | BeforeRetryResult>
    onError?: (ctx: ErrorContext) => Error | void | Promise<Error | void>
  }

  observe?: (event: WeiboEvent) => void | Promise<void>
}
```

### 4.1 上下文

| 类型 | 字段 |
|---|---|
| `RequestContext` | `method` / `url` / `headers` / `query` / `body` / `endpoint` / `resourceType` / `attempt` / `traceId` / `authMode` / `credentialId` |
| `ResponseContext` | 上面的字段 + `status` / `responseHeaders` / `data` / `durationMs` |
| `RetryContext` | 上面的字段 + `maxAttempts` / `reason` / `delayMs` / `retry` / `error` |
| `ErrorContext` | 上面的字段 + `phase` / `error` / `authFailureReason?` |

`beforeRequest` 可以原地修改 `headers` / `query` / `body`；`afterResponse` 约定只读。

### 4.2 执行时机与错误语义

| 扩展点 | 时机 | 抛错 | 能否改变结果 |
|---|---|---|---|
| `transport` | 每次 `send()` 外层 | fatal | 可短路 / 替换响应 |
| `beforeRequest` | 鉴权头注入后、发送前 | fatal | 可改请求 |
| `afterResponse` | 收到响应、okPolicy 前 | fatal | v1 只读 |
| `beforeRetry` | 已决定重试、sleep 前 | fatal | 可改延迟 / 阻止重试 |
| `onError` | 终态错误抛出前 | fatal | 可替换错误 |
| `observe` | 事件发出时 | **吞掉** | 不可以 |

### 4.3 顺序

`pre` → `normal` → `post`；同组按 `plugins` 数组顺序；每个 hook 独立排序。所有生命周期 hook 串行执行。

```ts
new WeiboSDK({
  plugins: [
    { name: 'metrics', apiVersion: 1, enforce: 'post', observe: event => metrics.push(event) },
    { name: 'trace-headers', apiVersion: 1, enforce: 'pre', hooks: {
      beforeRequest(ctx) { ctx.headers['x-trace-id'] = ctx.traceId },
    } },
  ],
})
```

### 4.4 只读观察者

```ts
const logger: WeiboPlugin = {
  name: 'logger',
  apiVersion: 1,
  observe(event) {
    // 不 await、不改状态、抛错会被吞掉
    console.log(JSON.stringify(event))
  },
}
```

`observe` 会收到 Wide Events（`request_start` / `request_success` / `request_error` / `request_retry` / `rate_limit_wait` 等）与生命周期事件（`sdk_init` / `self_check_*`）。

---

## 5. 常见插件

### 5.1 缓存（transport 中间件）

```ts
const cache = new Map<string, Awaited<ReturnType<WeiboTransport['send']>>>()

const cachePlugin: WeiboPlugin = {
  name: 'cache',
  apiVersion: 1,
  transport(next) {
    return {
      async send(request) {
        const key = `${request.method} ${request.url} ${JSON.stringify(request.query ?? {})}`
        const hit = cache.get(key)
        if (hit)
          return hit
        const response = await next.send(request)
        if (response.status === 200)
          cache.set(key, response)
        return response
      },
    }
  },
}
```

### 5.2 自定义请求头 / 签名

```ts
const signing: WeiboPlugin = {
  name: 'signing',
  apiVersion: 1,
  hooks: {
    beforeRequest(ctx) {
      ctx.headers['x-client'] = 'my-app'
    },
  },
}
```

### 5.3 重试调参

```ts
const slowRetry: WeiboPlugin = {
  name: 'slow-retry',
  apiVersion: 1,
  hooks: {
    beforeRetry() {
      return { delayMs: 2000 }
    },
  },
}
```

---

## 6. 兼容层与默认值

| 配置 | 默认值 | 说明 |
|---|---|---|
| `transport` | `AxiosTransport` | 显式替换才改变行为 |
| `plugins` | `[]` | 无插件时走 identity 快路径 |
| `fetch` | `globalThis.fetch` | guest token 发放使用；主 transport 需显式 `fetchTransport({ fetch })` |
| `hooks` | — | 语义不变；`onRaw` / `onFetched` / `onError` / `onLifecycle` 保留原调用点 |
| `telemetry` | 关闭 | 失败不影响业务 |
| `logging` | **已删除** | 用 `observe` 或 logger 插件替代 |

`config.hooks` 与 `config.telemetry` 不需要迁移；插件是叠加层。

---

## 7. 约束

1. 插件只在 `new WeiboSDK()` 时组装，不支持 `sdk.use()` 热插拔。
2. 插件必须显式传入，禁止模块加载时自动注册（否则 `sideEffects: false` 失真）。
3. 插件不得依赖 `axios` / `zod` 的内部类型；公共类型只用 `WeiboTransport` 与上下文类型。
4. 新增公开导出时同步更新 `tests/unit/entry/exports.test.ts` 与 `docs/README.md`。
5. `observe` 不得阻塞；实现方自行排队。
6. `transport` 中间件必须保持「所有 HTTP 状态码正常返回」契约。
