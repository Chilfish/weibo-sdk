# 调研：插件化架构、传输适配与凭证池（2026-10-21）

> **目的**：评估三件事——多账号 token 池是否有必要、插件化架构在本项目应如何落地、下游引用 npm 包再打包时如何保证产物准确性。
> **方法**：阅读 `FetcherService` / `AuthProvider` / `GuestTokenService` / `RateLimitService` / `RetryPolicy` / `capabilities` 与发布配置；用 `gh` 直接读 Octokit、Ky、before-after-hook、unjs/hookable、Vite 的插件与钩子实现；核对当前 `package.json` / `tsdown.config.ts` / 导出测试。
> **状态**：仅调研与规划，**尚未改代码**。行动项见 §8。

---

## 0. 结论先行（TL;DR）

1. **不做多账号 token 池轮换**。真正「token 无关」的端点就是 `auth: 'guest'` 那批；换 token 不改变数据，而微博 432 主要打在 IP / 行为维度，不在 token 维度。账号级端点轮换会直接改变数据语义，非账号级 cookie 端点也会因可见范围不同而改变结果集。
2. **保留凭证接缝，不保留池实现**。把 `AuthProvider` 提升为 `CredentialResolver`（默认单凭证），telemetry 增加 `credential_id`；将来若确有需求，池是一个外置实现，不改 `FetcherService`。
3. **插件化采用三层结构**：Ports（构造注入的环境适配器）→ Core 状态机（retry / rate-limit / auth-refresh / okPolicy / Zod）→ Plugins（生命周期钩子 + transport 中间件 + 只读观察者）。
4. **自定义 fetch 是最有价值的一块**。抽出 `WeiboTransport` 端口后，worker / edge / 测试替身 / 浏览器去 axios 四个问题一起解决；`GuestTokenService` 现有的 `GuestFetch` 注入也应合并到同一个端口。
5. **下游默认必须零配置可用**：`new WeiboSDK({})` 继续是访客身份；所有插件、telemetry、自定义 transport 全部可选；核心包在无插件时零额外分配。
6. **发布产物要单独建门禁**。当前 `exports` 缺少 `types` 条件、`sideEffects: false` 与 CLI 顶层 `runMain()` 不一致、没有 `engines`、browser 入口内联 axios/zod、导出测试只看字段形状。需要 `publint` + `@arethetypeswrong/cli` + `pnpm pack` 后真实安装 + Vite/esbuild 打包 + tree-shaking 断言。详见 [package-integrity.md](../engineering/package-integrity.md)。

---

## 1. 问题定义与边界

### 1.1 要解决的三个问题

| 问题 | 典型场景 | 本方案的归属 |
|---|---|---|
| 环境适配 | Cloudflare Worker / Deno / Bun / 浏览器扩展里没有 axios，或不想用 axios；测试要替换 HTTP | **Ports**：`WeiboTransport`、`GuestFetch`、`Clock` |
| 横切扩展 | 日志、遥测、指标、缓存、mock、自定义请求头、熔断、签名 | **Plugins / Observers**：生命周期钩子 + transport 中间件 + 只读事件流 |
| 凭证策略 | 单 Cookie / 访客 token / 将来可能的多凭证 | **Ports**：`CredentialResolver`（默认单凭证） |

### 1.2 非目标

- **不做万能插件容器**。不引入 `hookable` 之类的通用事件总线，也不让插件重写 retry / rate-limit / auth-refresh 的核心顺序。
- **不做运行时热插拔**。插件在 `new WeiboSDK()` 时组装完成，避免在途请求与插件顺序不一致。
- **不做多账号轮换**（见 §3）。
- **不新增 CJS 构建**。当前包是 ESM-only；加 CJS 会引入双包危害与双份类型，收益不足。
- **不把 CLI 与 SDK 拆成两个包**。CLI 只通过 `./cli` 子路径与 bin 暴露。

---

## 2. 现状盘点（代码事实）

### 2.1 请求链路

```
Service.request(spec, args)
  → resolveProvider(spec.auth)                 // AuthProvider
  → requestOnce()
      → fetch()                                // preflight + retry loop
          → sendAttempt()
              → rateLimitService.acquire()
              → provider.getHeaders()
              → axios.request()                // ← 唯一传输实现
          → mapError()                         // ← axios.isAxiosError / response.status
      → emitRaw()                              // hooks.onRaw
      → okPolicy（ok !== 1）
      → spec.schema.safeParse()
      → emitFetched() / telemetry
```

### 2.2 已有的接缝

| 接缝 | 位置 | 现状 |
|---|---|---|
| HTTP client | `FetcherService` 构造 deps `client?: AxiosInstance` | 只能在 axios 内替换，无法换成原生 fetch |
| 鉴权 | `AuthProvider` + `createAuthContext` | cookie / guest / none 三态；guest 有 single-flight 与刷新 |
| 访客发放 | `GuestTokenService` deps `fetch?: GuestFetch` | 已有最小 fetch 契约，但与主传输各用一套 |
| 限流 | `RateLimitService` 构造注入 `clock` | 实例级令牌桶，支持 432 全局暂停 |
| 时间 | `IRateLimitClock` | 测试可注入 FakeClock |
| 遥测 | `WeiboSDKTelemetry.emit` | 已包裹 try/catch，失败不影响业务 |
| 回调 | `WeiboSDKHooks`（onRaw / onFetched / onError / onLifecycle） | 抛错会向上传播；与 telemetry 语义不同 |

### 2.3 主要耦合点

| 位置 | 事实 | 影响 |
|---|---|---|
| `FetcherService.createAxiosClient` | 直接 `axios.create` | 无法换传输；browser 构建必须内联 axios |
| `FetcherService.sendAttempt` | 构造 `AxiosRequestConfig`、`maxRedirects`、`validateStatus`、proxy 形状 | 这些是 axios 语义，不是 HTTP 契约 |
| `FetcherService.mapError` | `axios.isAxiosError` + `response.status/data/headers` | 错误映射与 axios 绑定 |
| `sendAttempt` | 直接改写 `resource.headers` | 共享对象被修改，未来 transport 中间件容易踩坑 |
| `AuthProvider` | `mode` 在构造时固定，`getProvider(auth)` 只做端点筛选 | 无法按请求选择凭证；`getSession()` 只缓存一个 uid |
| `RateLimitService` | 实例级令牌桶 | 多凭证 / 多代理时没有按维度隔离 |
| `types/config.ts` | `logging?: boolean` | **当前没有任何读取点**，是死配置 |
| `src/cli.ts` | 顶层 `runMain(withErrorEnvelope(main))` | `sideEffects: false` 对 `./dist/cli.mjs` 不准确 |
| `package.json#exports["."]` | 裸字符串 `./dist/index.mjs` | 没有 `types` 条件；TS `node16` / `bundler` 解析依赖顶层 `types` 兜底 |
| `tsdown.config.ts` browser | `alwaysBundle: ['axios', 'zod']` | 用户脚本零依赖可用；SPA 二次打包可能重复 zod |
| `package.json` | 没有 `engines` | `process.getBuiltinModule` 实际要求 Node 20.16+ / 22.3+，但文档写的是 Node 18+ |
| `tests/unit/entry/exports.test.ts` | 只断言字段形状与 `sideEffects === false` | 不验证真实 tarball、类型解析、打包产物 |

---

## 3. 多账号 token 池：调研与结论

### 3.1 先区分「token 无关」的两种含义

| 含义 | 端点 | 换 token 后数据是否变化 |
|---|---|---|
| 身份无关（匿名可读） | `auth: 'guest'`：用户资料、单条微博、评论、转发、点赞者、媒体墙、相册、视频、热搜、超话 | 不变 |
| 账号无关（谁问都一样） | 部分 `auth: 'cookie'` 的公开读：他人时间线、关注 / 粉丝、他人点赞 | **可能变化**：不同账号的可见范围不同 |
| 账号级 | `accountScoped: true`：收藏、历史评论、通知、@我、我的关注、首页关注流、归档 | **一定变化** |

`capabilities.ts` 已经提供 `accountScoped`，是判断能否轮换的第一手依据。注意 `likes.list` 当前没有标记 `accountScoped`，但「我赞过的」语义上属于账号相关，落地凭证策略前应补齐。

### 3.2 guest token 池的收益为什么低

- **限流维度错位**：微博 432 主要是 IP + 行为风控。同一个 IP 换 10 个 guest token，仍然会 432；每个新 token 还要多发 2 个请求（`genvisitor → incarnate`），反而更容易触发风控。
- **现有机制已覆盖失效**：`GuestTokenService` 有实例级缓存、single-flight、失效后单次刷新；池不会让「token 失效」这件事更可靠。
- **吞吐瓶颈不在 token 数**：当前 `RateLimitService` 是客户端礼貌限流（默认并发 3、间隔 1000ms）。不放开这些限制，换 token 不会提高吞吐；放开限制后，真正需要的是 **IP / 代理池**，而 `config.proxy` 已经支持动态 Provider。
- **成本**：池需要 per-credential 的限流、冷却、失败计数、single-flight、状态暴露；这些状态与 `getSession()`、归档、telemetry 都要重新定义。

### 3.3 cookie 账号池的收益为什么更低

- 账号级端点绝对不能轮换：`favorites`、`commentHistory`、`notifications`、`mentions`、`friendTimeline`、`archive` 换了账号就是另一份数据。
- 非账号级 cookie 端点也会变：粉丝可见、好友圈、隐私账号、拉黑关系都会影响结果集。静默轮换会破坏「契约稳定」这一项目目标，性质和「Cookie 失效不静默降级 guest」相同。
- 多账号与项目边界冲突：`AGENTS.md` 明确「只使用自己的账号 Cookie」「尊重微博条款与隐私」。池化会引入合规与账号安全风险。
- `backlog.md` 已在 2026-10-20 将「多账号登录态隔离」列为不再推进。

### 3.4 结论

**当前场景不需要 token 池。** 只做两件事：

1. 把 `AuthProvider` 提升为 `CredentialResolver`，默认 `SingleCredentialResolver`，让「按请求选凭证」成为可能。
2. telemetry / 错误 context 增加 `credential_id`（非敏感标识，不含 Cookie 明文），先让多凭证可观测。

将来若确有需求，池作为**外置插件**实现，并强制：

- 只有 `auth: 'guest'` 或 `capability.accountScoped === false` 的端点允许轮换；
- `accountScoped` 端点必须 pin 到主账号，未显式声明时直接拒绝；
- 每个凭证独立限流与冷却，但全局暂停仍然生效；
- 432 只冷却「当前凭证 + 当前出口 IP」，不能假设换 token 就能绕过；
- `getSession()` / 归档必须显式接收或继承 pin 住的凭证，禁止隐式漂移。

> 产物：不做池化代码；只保留 `CredentialResolver` 接口与 `credential_id` 观测字段。

---

## 4. 外部项目调研

### 4.1 对照表

| 项目 | 插件模型 | 钩子 / 扩展点 | 值得借鉴 | 不照搬 |
|---|---|---|---|---|
| **Octokit**（`@octokit/core`） | 插件是构造器变换：`Octokit.plugin(pluginA, pluginB)`，插件函数拿到实例与 options，返回要合并的方法 | `hook.before / after / error / wrap('request')`；`authStrategy` 是独立端口；`request.fetch` 可注入 | 端口分离；retry / throttling 作为插件包在 `request` 外层；`wrap` 是强力的粗粒度扩展点 | 插件直接往实例塞方法，对本项目会破坏能力边界 |
| **Ky** | 无插件注册，纯 options | `init / beforeRequest / beforeRetry / beforeError / afterResponse` 数组；`fetch` 可替换；`context` 透传；返回 `Request` / `Response` / `ky.retry()` 控制流程 | 钩子语义最清晰；串行执行；可短路；`fetch` 与 hooks 分离；错误在 `beforeError` 统一处理 | 全部塞进一个 options 对象，类型会膨胀；本项目需要按端点声明鉴权 |
| **before-after-hook** | 用 `reduce` 把钩子包在方法外 | `before` / `after` / `error` / `wrap` | 实现极简；`wrap` 可完整包裹一次调用 | 顺序是 LIFO（后注册的先执行），容易反直觉；不提供 `enforce` |
| **unjs/hookable** | 注册 / 注销函数 | `hook` / `hookOnce` / `callHook` / `callHookParallel` / `beforeEach` / `afterEach` / 命名空间 / 废弃映射 | 注册与注销、串行 vs 并行、spy 钩子、命名空间 | 对 SDK 偏重；引入外部依赖与新的事件类型系统，收益不足 |
| **Vite** | 插件对象 + 每个 hook 独立排序 | `enforce: 'pre' \| 'post'`；hook 也可以是 `{ order, handler }`；按 hook 缓存排序结果 | 顺序显式化；每个 hook 独立排序；插件名唯一 | 构建管线是固定阶段，和请求状态机不同，不能直接套 |

### 4.2 关键判断

1. **「插件」和「适配器」不是一回事**。Octokit 的 `authStrategy`、`request.fetch` 是适配器；retry / throttling 才是插件。把两者混在一个数组里，会让「换 fetch」这种基础能力也依赖插件顺序。
2. **`wrap` 很强大，但只适合粗粒度外层**。Octokit 的 retry 插件就是 `hook.wrap('request')` + `hook.error('request')`。本项目的 retry / auth-refresh / rate-limit 顺序是正确性的一部分，不应下放给插件；只把 `transport` 作为可包装的窄边界。
3. **观察者必须与行为插件分开**。日志 / 遥测 / 指标失败不能影响请求；生命周期钩子失败应该 fatal。混在一起会让「抛不抛错」变成每个插件自己的约定。
4. **顺序要显式**。采用 Ky 的串行语义 + Vite 的 `enforce`，比 before-after-hook 的隐式 LIFO 更好维护。

---

## 5. 推荐架构

### 5.1 三层结构

```
WeiboSDK（门面）
 ├─ Ports（构造注入，不是插件）
 │   ├─ WeiboTransport       AxiosTransport（默认）/ FetchTransport / 自定义
 │   ├─ CredentialResolver   SingleCredentialResolver（默认）/ 池（未来，外置）
 │   ├─ Clock
 │   └─ TelemetrySink / LoggerSink
 ├─ Core state machine（不插件化）
 │   ├─ 端点鉴权要求（EndpointSpec.auth）
 │   ├─ retry / rate-limit / auth-refresh
 │   ├─ okPolicy
 │   └─ Zod 校验
 └─ Plugins（构造期组装一次）
     ├─ lifecycle hooks      beforeRequest / afterResponse / beforeRetry / onError
     ├─ transport middleware cache / mock / circuit breaker / signing
     └─ observers            日志 / 遥测 / 指标（只读，异常吞掉）
```

**为什么核心状态机不插件化**：

- retry、rate-limit、auth-refresh 的先后顺序是正确性的一部分。比如 432 后必须先暂停令牌桶再重试；guest 鉴权失败只能刷新一次；这些规则不能变成用户可配置的顺序。
- 热路径必须无插件时零额外分配。每请求构造插件上下文、遍历空数组，会直接放大归档的请求成本。
- 插件应该「锦上添花」，不能重写状态机。需要完全接管请求的场景，用 `transport` 中间件，而不是重写 `request()`。

### 5.2 Ports：传输

```ts
export interface TransportRequest {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  query?: Record<string, unknown>
  body?: Record<string, unknown>
  timeoutMs: number
  redirect: 'follow' | 'manual'
  signal?: AbortSignal
  /** 已解析的代理 URL；false 表示直连；自定义 transport 可忽略 */
  proxy?: string | false
  meta: {
    endpoint?: string
    resourceType?: IResourceType
    attempt: number
    traceId: string
    authMode: 'cookie' | 'guest'
    credentialId?: string
  }
}

export interface TransportResponse {
  /** 所有 HTTP 状态码都正常返回；只有网络 / 超时才抛错 */
  status: number
  /** header 名统一小写；值可能是 string / string[] */
  headers: Record<string, string | string[] | undefined>
  /** JSON 已解析；非 JSON 返回文本（登录页 / 风控页可读） */
  data: unknown
  url?: string
}

export interface WeiboTransport {
  send(request: TransportRequest): Promise<TransportResponse>
}
```

实现与约束：

- `AxiosTransport`：默认实现，保持现有 `maxRedirects` / `validateStatus` / proxy 行为。
- `FetchTransport`：`fetchTransport({ fetch })`，可用于 Worker / Edge / Deno / Bun；`GuestTokenService` 的 `GuestFetch` 合并到同一个注入点。
- `TransportFailure`：只表达 `timeout` / `network`，携带 `cause`；HTTP 语义（432 / 429 / 403 / 3xx / 登录页）继续留在 `FetcherService`，避免两套错误映射。
- **禁止修改传入的 request**；每次重试构造新对象。
- header 名统一小写，避免 axios 与 fetch 的大小写差异。
- transport 必须支持 `redirect: 'manual'`，否则 guest 的登录页 / visitor 入口判定失效。

### 5.3 Ports：凭证

```ts
export interface Credential {
  /** 非敏感标识，用于 telemetry / 错误 context；不含 Cookie 明文 */
  id: string
  mode: 'cookie' | 'guest'
  getHeaders(): Promise<Record<string, string>>
  refresh?(reason: AuthFailureReason): Promise<boolean>
}

export interface CredentialResolver {
  resolve(ctx: {
    endpoint: string
    auth: EndpointAuth
    attempt: number
    traceId: string
  }): Credential | Promise<Credential>
  report?(ctx: {
    credential: Credential
    outcome: 'ok' | 'rate_limited' | 'auth_failed'
    error?: unknown
  }): void
}
```

- 默认 `SingleCredentialResolver` 包装现有 `AuthService` / `GuestTokenService`，行为不变。
- `guest` 模式下拒绝 cookie-only 端点的逻辑仍在 `FetcherService`，不交给 resolver。
- telemetry 增加 `credential_id`；`getSession()` 返回主凭证的会话；归档必须 pin 主凭证。
- 池化是 `CredentialResolver` 的另一个实现，核心不感知。

### 5.4 Plugins

```ts
export interface WeiboPlugin {
  /** 唯一名；重名直接 CONFIG_INVALID，不静默去重 */
  name: string
  /** 默认 normal；pre 先于 normal，post 后于 normal */
  enforce?: 'pre' | 'post'

  /** 包装 transport：cache / mock / circuit breaker / 请求签名 */
  transport?: (next: WeiboTransport) => WeiboTransport

  hooks?: {
    /** 发请求前；可改 headers / query / body */
    beforeRequest?: (ctx: RequestContext) => void
    /** okPolicy / Zod 之前；默认只读 */
    afterResponse?: (ctx: ResponseContext) => void
    /** 已决定重试后；可改延迟或阻止重试 */
    beforeRetry?: (ctx: RetryContext) => void | { retry?: boolean, delayMs?: number }
    /** 终态错误抛出前；可替换错误 */
    onError?: (ctx: ErrorContext) => void | Error
  }

  /** 只读观察者：不 await、吞异常、不能改状态 */
  observe?: (event: WeiboEvent) => void
}
```

语义约定：

| 扩展点 | 执行时机 | 抛错语义 | 能否改变结果 |
|---|---|---|---|
| `transport` 中间件 | 每次 `send()` 外层 | fatal | 可以短路 / 替换响应 |
| `beforeRequest` | 每次尝试、注入鉴权头之后 | fatal | 可以改请求 |
| `afterResponse` | 收到 raw、`okPolicy` 之前 | fatal | v1 只读，不替换 |
| `beforeRetry` | 判定可重试之后、sleep 之前 | fatal | 可改延迟 / 阻止重试 |
| `onError` | 终态错误抛出前 | fatal | 可替换错误 |
| `observe` | 事件发出时 | **吞掉** | 不可以 |

顺序：

- 按 `enforce` 排序：`pre` → `normal` → `post`；同组内按注册顺序；每个 hook 单独排序（Vite 模型）。
- 所有 hook 串行执行（Ky 模型），不做隐式洋葱；需要洋葱语义用 `transport` 中间件。
- v1 只在构造期注册；不提供 `sdk.use()` 热插拔。同名插件直接报错，避免顺序歧义。
- 插件 API 加 `apiVersion: 1` 字段（可选校验），为未来 breaking 预留明确信号。

`config.hooks` 与 `config.telemetry` 的兼容策略：

- `hooks` 实现为内置 `hooksPlugin`，映射到 `onRaw` / `onFetched` / `onError` / `onLifecycle`。
- `telemetry` 实现为内置 `telemetryPlugin`（observer）。
- `logging` 是死配置，直接并入 `loggerPlugin` 的文档说明，不再保留布尔开关。

### 5.5 现有能力的新位置

| 现有能力 | 目标位置 | 说明 |
|---|---|---|
| `deps.client`（AxiosInstance） | `transport` | 仍可注入 axios 实例，但通过 `AxiosTransport` 包装 |
| `GuestFetch` | `transport` 的 fetch 实现 | 统一一个 fetch 注入点 |
| `AuthService` / `GuestTokenService` | `CredentialResolver` 内部 | 默认实现不变 |
| `RateLimitService` / `RetryPolicy` / `resolveProvider` | Core | 不插件化 |
| `hooks.onRaw` / `onFetched` / `onError` / `onLifecycle` | lifecycle hooks | 兼容插件 |
| `telemetry` | observer | 语义不变（失败不影响业务） |
| `logging`（当前未使用） | logger observer | 删除死配置 |
| `proxy` / `proxyUrl` | transport 配置 | 默认 transport 继续支持动态 Provider |
| 未来缓存 / mock / 熔断 | transport 中间件 | 拿 raw，不碰 schema |
| 未来 token 池 | `CredentialResolver` 插件 | 默认不启用 |

---

## 6. 下游开箱即用（DX 契约）

### 6.1 零配置必须成立

```ts
// 1. 访客身份，零配置
const sdk = new WeiboSDK({})
const tweet = await sdk.tweets.getByMblogId('OgHLUyXYP')

// 2. 有 Cookie 就自动用 Cookie
const sdk = new WeiboSDK({ cookie })

// 3. 其余全部可选
const sdk = new WeiboSDK({
  cookie,
  transport: fetchTransport({ fetch: myFetch }), // 只在需要时
  plugins: [loggerPlugin()],                     // 只在需要时
})
```

### 6.2 默认值原则

| 配置 | 默认值 | 原则 |
|---|---|---|
| `auth` | `auto` | 有 Cookie 用 Cookie，没有用访客；不静默降级 |
| `selfCheck.mode` | `lazy` | 构造不发请求；首次请求前自检一次 |
| `retry` | 2 次，500ms 起，8s 上限 | 对限流 / 5xx / 超时 / 网络错误生效 |
| `maxConcurrent` / `delay` | 3 / 1000ms | 礼貌限流，避免默认就被 432 |
| `guest.autoRefresh` | `true` | 每请求最多刷新一次 |
| `telemetry` | 关闭 | 库入口不产生 IO / console |
| `plugins` | 空 | 无插件时零额外分配 |
| `transport` | `AxiosTransport` | 保持现有行为；显式换 fetch 才变 |
| `logging` | 删除 | 日志走 logger 插件 |

**配置只做加法**：现有字段全部保留；新字段全部 optional；不要求用户为了用核心能力安装插件或写适配器。默认路径必须是「最少概念、最少配置、最少请求」。

### 6.3 可发现与可诊断

- `sdk.capabilities()` / `weibo-cli capabilities` 继续是能力发现入口；新增插件能力时同步登记。
- 错误继续使用结构化 `code / level / retryable / context / hint / next`，插件不得破坏错误形状。
- telemetry 事件保持扁平 KV；插件通过 `observe` 消费，不新增嵌套 JSON。
- CLI 不新增插件相关 flag；插件是 SDK 使用者的代码级扩展，不是终端用户的配置项。

---

## 7. 下游打包产物准确性（摘要）

详细核验矩阵与规则见 [package-integrity.md](../engineering/package-integrity.md)。这里只记录结论：

- 包保持 **ESM-only**；不新增 CJS 构建。
- `exports` 根入口补 `types` 条件；`./cli` 补类型或明确不承诺类型。
- `sideEffects: false` 与 CLI 顶层 `runMain()` 冲突：改为 `sideEffects: ["./dist/cli.mjs"]`，或拆分 `src/cli.ts`（导出命令树）与 bin 入口（执行 `runMain`）。推荐拆分。
- 补 `engines.node`（至少 `>=20.16`，推荐 `>=22`），与 `process.getBuiltinModule` 的实际要求一致。
- 公开 `.d.mts` 不得引用 `axios` / `zod` 类型；组件的公共类型继续用 `z.infer` 的输出。
- browser 入口保持自包含（用户脚本 / 无打包器）；SPA 走 bundler 时依赖由宿主去重。是否给根入口加 `browser` 条件，等 FetchTransport 落地后用真实产物评估，不在本轮拍板。
- 发布门禁新增：`pnpm pack` → `publint` → `attw --pack` → 临时目录安装 → Node ESM import → `tsc` 类型检查 → Vite/esbuild 打包 → tree-shaking 断言。

---

## 8. 行动计划

> 原则：先抽端口、再加插件、最后做包门禁；每一步都可独立合并、可独立回滚。默认路径（`new WeiboSDK({})`）在任何阶段都必须保持可用。

### Phase 0：文档（本轮）

- 新增本文件与 [package-integrity.md](../engineering/package-integrity.md)。
- 新增 ADR-014 / ADR-015 / ADR-016。
- 更新 `backlog.md`、`docs/README.md`、开发日志。
- 提交：`docs: plan plugin architecture, transport port and package integrity`

### Phase 1：Transport 端口（P0）

- 新增 `src/services/internal/transport/`：
  - `types.ts`：`TransportRequest` / `TransportResponse` / `WeiboTransport` / `TransportFailure`。
  - `AxiosTransport.ts`：包装现有 axios 行为（proxy、manual redirect、status 不抛错）。
  - `FetchTransport.ts`：基于可注入 fetch；`GuestTokenService` 复用同一个 fetch。
- `FetcherService` 改为只依赖 `WeiboTransport`：
  - `mapError` 拆成 `TransportFailure` 映射 + HTTP 状态分类。
  - `sendAttempt` 不再修改 `resource.headers`，每次构造新 request。
  - `deps.client` 保留，内部包装为 `AxiosTransport`。
- 提交：
  1. `refactor(http): extract transport port from fetcher`
  2. `feat(http): add fetch transport and share fetch with guest tokens`
  3. `test(http): add transport contract tests`

**DoD**：

- 现有离线测试全绿，无公开 API 破坏。
- axios / fetch 两种 transport 在同一组 fixture 上产出相同 `status` / `data` / header 语义。
- 432 / 429 / 403 / 302 / HTML 登录页 / 超时 / 网络错误全部覆盖。
- `guest` 模式仍能识别 visitor 入口与登录页重定向。

### Phase 2：CredentialResolver（P1）

- 把 `AuthProvider` 重命名 / 提升为 `CredentialResolver` + `Credential`。
- 默认 `SingleCredentialResolver` 包装 `AuthService` / `GuestTokenService`。
- telemetry 增加 `credential_id`；错误 context 同步。
- 补齐 `likes.list` 的 `accountScoped` 标记（若确认语义）。
- 提交：
  1. `refactor(auth): introduce credential resolver port`
  2. `feat(telemetry): record credential id`

**DoD**：

- cookie / guest / none 三态行为不变。
- guest 下 cookie-only 端点仍在发请求前拒绝。
- `getSession()` 仍只探测一次；归档仍 pin 主凭证。
- 不引入任何池化代码。

### Phase 3：插件管线（P1）

- 新增 `src/services/internal/plugins/`：
  - `types.ts`：`WeiboPlugin` / 上下文 / `WeiboEvent`。
  - `pipeline.ts`：按 `enforce` 排序、编译为单次调用的函数；无插件时走 identity 快路径。
  - `builtin/hooks.ts` / `builtin/telemetry.ts` / `builtin/logger.ts`。
- `IWeiboConfig` 新增 `plugins?: WeiboPlugin[]`。
- `config.hooks` / `config.telemetry` 映射到内置插件；`logging` 标 deprecated 或删除。
- 提交：
  1. `feat(plugins): add ordered lifecycle plugin pipeline`
  2. `refactor(hooks): implement legacy hooks as a built-in plugin`
  3. `test(plugins): cover ordering, short-circuit and observer isolation`
  4. `docs: document plugin api and defaults`

**DoD**：

- 无插件时行为与性能基线不变（加一条零插件请求的分配 / 调用次数断言）。
- 同名插件报 `CONFIG_INVALID`。
- observer 抛错不影响请求；生命周期钩子抛错按文档 fatal。
- 现有 `hooks` / `telemetry` 用法不破坏。

### Phase 4：包完整性门禁（P1）

- `package.json`：补 `engines`、`exports` 的 `types` 条件、`sideEffects` allowlist。
- 拆分 `src/cli.ts`：命令树导出 + `src/cli-bin.ts` 执行 `runMain()`。
- 新增脚本：
  - `pnpm run verify:package`：`pnpm pack` + 临时安装 + Node import + CLI `--version`。
  - `pnpm run lint:package`：`publint` + `@arethetypeswrong/cli --pack`。
  - `pnpm run test:bundle`：Vite / esbuild 打包 + tree-shaking 断言。
- CI 接入上述门禁。
- 提交：
  1. `chore(package): add exports types, engines and sideEffects allowlist`
  2. `refactor(cli): split command tree from bin entry`
  3. `test(package): verify packed artifact with publint and attw`
  4. `ci: add package integrity gate`

**DoD**：见 [package-integrity.md](../engineering/package-integrity.md) §5 的完整矩阵。

### Phase 5：可选凭证池（P2，未排期）

- 只有出现明确需求（多账号 + 多代理 + 高吞吐归档）才做。
- 以外部插件形式实现 `PooledCredentialResolver`，不改核心。
- 强制 `accountScoped` pin 主账号；`credential_id` / `credential_switch_reason` 进 telemetry。
- 不纳入本轮计划。

---

## 9. 测试策略

| 层级 | 用例 |
|---|---|
| Unit | transport 请求构造 / header 小写 / 参数序列化；插件排序 / 短路 / 错误语义；`CredentialResolver` 选择；`computeBackoffDelay` 不变 |
| Component | fake transport 驱动完整 `request()`；432 → 暂停 + 重试；403 / 302 / HTML → guest 刷新一次；`okPolicy` / Zod / hooks / telemetry 顺序 |
| Contract | axios / fetch 两种 transport 对同一组响应（200 JSON、空对象、HTML、302、403、432、超时）产出相同结果 |
| Package | `pnpm pack` + `publint` + `attw --pack` + 临时安装 + `tsc` + Vite/esbuild 打包 + tree-shaking + Worker smoke |
| E2E | 保持现有 `WEIBO_E2E=1` / `WEIBO_GUEST_E2E=1` 门控，不因插件化增加真实请求 |

---

## 10. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| axios 与 fetch 语义漂移 | guest 登录页检测 / 3xx / header / proxy 行为变化 | transport contract tests；默认仍用 `AxiosTransport`，`FetchTransport` 显式启用 |
| 插件顺序与错误语义不清 | 用户行为不可预测 | 文档 + 测试固定 `pre → normal → post`；observer 与 lifecycle 分离 |
| 热路径性能回归 | 归档请求成本上升 | 无插件 identity 快路径；编译期排序；基准断言 |
| 包配置改动破坏下游 | 类型解析 / 打包失败 | 先加 `types` 条件与测试；`sideEffects` 只做精确 allowlist；发布前真实 tarball 安装 |
| 范围蔓延到 token 池 | 复杂度与合规风险 | ADR-015 明确不做；池只作为外置插件候选 |
| browser 内联 zod 导致重复 | bundle 体积 / `instanceof` 跨副本 | 保持 `./browser` 仅面向用户脚本；SPA 走根入口由宿主去重；后续用产物测量再决定 |
| Node 版本声明不准 | 旧 Node 上 Cookie 文件解析静默退化 | 补 `engines`；文档写清 `process.getBuiltinModule` 要求 |

**回滚策略**：

- Phase 1：`transport` 默认 `AxiosTransport`，不改变现有路径；出问题可切回。
- Phase 2：`SingleCredentialResolver` 只是包装；无行为变化。
- Phase 3：`plugins` 为空时走原路径；`hooks` / `telemetry` 兼容层保留。
- Phase 4：`exports` / `sideEffects` 改动先用 tarball 验证；必要时保留旧入口一版。

---

## 11. 待确认问题

1. `./cli` 是否承诺类型导出？如果承诺，需要 `dist/cli.d.mts` 并加 `types` 条件。
2. 根入口是否增加 `browser` 条件？建议等 `FetchTransport` 落地后，用 Vite 实际产物测量再定。
3. `axios` 在 `FetchTransport` 成为可行默认后，是否降为 optional peer？本轮不动。
4. 插件 `apiVersion` 是否强制？建议必填，便于未来明确拒绝不兼容插件。
5. 是否需要 `afterValidate` 钩子？v1 不做，避免 hook 面过大。
6. `getSession()` 在未来的多凭证下返回哪个凭证？本轮按「主凭证」实现。
7. `logging` 是删除还是先标 deprecated？倾向直接删除死配置，CHANGELOG 说明。

---

## 12. 参考资料

**本地代码**

- [`src/services/internal/FetcherService.ts`](../../src/services/internal/FetcherService.ts)
- [`src/services/internal/AuthProvider.ts`](../../src/services/internal/AuthProvider.ts)
- [`src/services/internal/GuestTokenService.ts`](../../src/services/internal/GuestTokenService.ts)
- [`src/services/internal/RateLimitService.ts`](../../src/services/internal/RateLimitService.ts)
- [`src/services/internal/RetryPolicy.ts`](../../src/services/internal/RetryPolicy.ts)
- [`src/capabilities.ts`](../../src/capabilities.ts)
- [`package.json`](../../package.json) / [`tsdown.config.ts`](../../tsdown.config.ts)

**外部实现**

- [Octokit core.js](https://github.com/octokit/core.js)（plugins / hooks / authStrategy / request.fetch）
- [before-after-hook](https://github.com/gr2m/before-after-hook)（before / after / error / wrap 的组合实现）
- [Ky](https://github.com/sindresorhus/ky)（hooks / fetch / context / retry）
- [unjs/hookable](https://github.com/unjs/hookable)（注册注销 / 串并行 / spy）
- [Vite Plugin API](https://vite.dev/guide/api-plugin)（enforce / 顺序）
- [publint](https://publint.dev/) / [Are the types wrong?](https://arethetypeswrong.github.io/)（包产物与类型解析核验）

**相关文档**

- [包完整性指南](../engineering/package-integrity.md)
- [架构决策记录 ADR-014 / ADR-015 / ADR-016](./architecture.md)
- [访客模式调研](./research-guest-mode-2026-10-20.md)
- [Backlog](./backlog.md)
