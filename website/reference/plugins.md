---
title: 传输与插件
outline: deep
---

# 插件与传输适配

## 1. 三层结构

```
WeiboSDK（门面）
 ├─ Ports（构造注入）
 │   ├─ WeiboTransport      AxiosTransport（默认）/ FetchTransport / 自定义
 │   ├─ CredentialResolver  SingleCredentialResolver（默认）
 │   └─ Clock               测试可注入 FakeClock
 ├─ Core
 │   ├─ EndpointSpec.auth
 │   ├─ retry / rate-limit / auth-refresh
 │   ├─ okPolicy
 │   └─ Zod 校验
 └─ Plugins（构造期组装一次）
     ├─ lifecycle hooks  beforeRequest / afterResponse / beforeRetry / onError
     ├─ transport        cache / mock / circuit breaker / signing
     └─ observe          日志 / 指标（只读，异常吞掉）
```

retry / rate-limit / auth-refresh 的顺序由 SDK 固定；默认使用单一 Cookie 凭证。

## 2. 传输端口

```ts
interface WeiboTransport {
  send: (request: TransportRequest) => Promise<TransportResponse>
}
```

契约：

- 所有 HTTP 状态码都作为正常响应返回；网络错误与超时抛 `TransportFailure`。
- `redirect: 'manual'` 时 3xx 原样返回，guest 登录页与访客入口判定依赖它。
- 传入的 request 保持不变；header 名统一小写。
- HTTP 语义（432 / 429 / 403 / 3xx / 登录页 / `Retry-After`）由 `FetcherService` 分类，transport 只负责收发。

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

`config.fetch` 供 `GuestTokenService` 发放访客 token 使用。只注入 `fetch` 时主请求仍走默认 axios transport；主请求要用 fetch 需显式传 `transport`。

自定义 transport 示例：

```ts
const mockTransport = {
  async send(request) {
    return { status: 200, headers: {}, data: { ok: 1, data: {} } }
  },
}

new WeiboSDK({ transport: mockTransport })
```

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

默认 `SingleCredentialResolver`：所有非 `none` 端点使用同一份主凭证。

- 凭证轮换会改变账号级端点的数据范围；访客 token 的发放受 IP 风控限制。
- `credential_id` 只包含 Cookie 指纹 / `guest-primary` / `none`。
- guest 模式下，cookie-only 端点在发请求前以 `AUTH_SESSION_EXPIRED` 拒绝。

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
| `afterResponse` | 收到响应、okPolicy 前 | fatal | 只读 |
| `beforeRetry` | 已决定重试、sleep 前 | fatal | 可改延迟 / 阻止重试 |
| `onError` | 终态错误抛出前 | fatal | 可替换错误 |
| `observe` | 事件发出时 | 吞掉 | 不可以 |

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
    // 同步返回，不改状态；抛错被吞掉
    console.log(JSON.stringify(event))
  },
}
```

`observe` 会收到 Wide Events（`request_start` / `request_success` / `request_error` / `request_retry` / `rate_limit_wait` 等）与生命周期事件（`sdk_init` / `self_check_*`）。需要分级、格式化或落盘时改用 `config.logger` 或 `createLoggerPlugin()`，见 [日志](./logging)。

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

## 6. 默认值

不传 `transport` 与 `plugins` 时按默认路径运行。

| 配置 | 默认值 | 说明 |
|---|---|---|
| `transport` | `AxiosTransport` | 显式替换才改变行为 |
| `plugins` | `[]` | 无插件时走 identity 快路径 |
| `fetch` | `globalThis.fetch` | guest token 发放使用；主 transport 需显式传 `fetchTransport({ fetch })` |
| `hooks` | 未设置 | `onRaw` / `onError` / `onLifecycle` 在原调用点触发 |
| `telemetry` | 关闭 | `emit` 失败被吞掉，不影响业务 |

## 7. 约束

1. 插件在 `new WeiboSDK()` 时组装一次，运行期沿用该配置。
2. 插件通过 `plugins` 显式传入，模块加载时不注册任何插件，`sideEffects: false` 保持有效。
3. 插件使用公共类型 `WeiboTransport` 与上下文类型，与 `axios` / `zod` 的内部类型解耦。
4. 新增公开导出时同步更新 `api-surface.json`、`api-surface.snapshot.json` 与 [导出索引](/api/types/)。
5. `observe` 同步返回；耗时的投递由实现方自己排队。
6. `transport` 中间件保持「所有 HTTP 状态码正常返回」的契约。
