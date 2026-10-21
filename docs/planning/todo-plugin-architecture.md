# 行动计划：插件化、传输适配与包完整性（PF1–PF6）

**来源**：[research-plugin-architecture-2026-10-21.md](./research-plugin-architecture-2026-10-21.md)、[package-integrity.md](../engineering/package-integrity.md)、[ADR-014 / ADR-015 / ADR-016](./architecture.md)。
**目标**：在不改变默认路径（`new WeiboSDK({})`）行为的前提下，抽出可替换的传输端口、凭证解析端口与插件管线，并把发布产物核验升级为真实 tarball 门禁。

## 已拍板决策

| 决策 | 结论 | 依据 |
|---|---|---|
| 多账号 token 池 | **不做**；只保留 `CredentialResolver` 接缝与 `credential_id` 观测 | research §3 / ADR-015 |
| 默认 transport | `AxiosTransport`；`FetchTransport` 显式启用 | research §6.2 |
| 自定义 fetch 注入点 | `IWeiboConfig.fetch` 同时供主 transport（`fetchTransport()`）与 `GuestTokenService` 使用 | research §5.2 |
| 插件热插拔 | **不支持**；构造期组装，`plugins` 数组显式传入 | research §1.2 / §5.4 |
| 插件顺序 | `pre → normal → post`，同组按注册顺序，每个 hook 独立排序 | research §5.4 |
| `apiVersion` | **必填**，当前只接受 `1`；不兼容直接 `CONFIG_INVALID` | research §11.4 |
| `afterValidate` | v1 不提供 | research §11.5 |
| `config.hooks` / `config.telemetry` | 保留语义不变；请求级 `onRaw` / `onError` 通过内置兼容插件接入管线 | research §5.4 |
| `logging` 死配置 | 删除（`CHANGELOG` 说明） | research §11.7 |
| `exports#types` | 全部改为条件对象，`types` 优先 | ADR-016 |
| CLI 入口 | 拆分 `src/cli.ts`（命令树）/ `src/cli-bin.ts`（`runMain`） | ADR-016 / R2 |
| `engines.node` | `>=20.16`（与 `process.getBuiltinModule` 对齐） | R3 |
| `schemas/` 随包发布 | 本轮不做，保留为独立决策 | package-integrity R10 |
| browser 条件 | 本轮不新增，等 `FetchTransport` 产物测量后再定 | research §11.2 |

## 实施范围

### PF1 Transport 端口（P0）

新增 `src/services/internal/transport/`：

- `types.ts`：`TransportRequest` / `TransportResponse` / `WeiboTransport` / `TransportFailure` / `FetchLike`。
- `AxiosTransport.ts`：默认实现；保留 proxy、`redirect: 'manual'`、所有 HTTP 状态正常返回。
- `FetchTransport.ts`：`fetchTransport({ fetch? })`；支持注入 fetch、超时、manual redirect、JSON / 文本响应。
- `index.ts`：公开导出。

`FetcherService` 改造：

- 只依赖 `WeiboTransport`；`deps.client` 内部包装为 `AxiosTransport`。
- `sendAttempt` 每次构造新 `TransportRequest`，不再改写 `resource.headers`。
- HTTP 语义（432 / 429 / 403 / 3xx / 登录页 / `Retry-After`）留在 `FetcherService`；transport 只抛 `TransportFailure`（timeout / network）。
- `IWeiboConfig.transport?: WeiboTransport`、`IWeiboConfig.fetch?: FetchLike`。

### PF2 FetchTransport + GuestFetch 合并（P0/P1）

- `GuestTokenService` 的 `GuestFetch` 改为复用 `FetchLike` 类型；`config.fetch` 注入到 guest token 发放。
- transport contract tests：同一组 fixture（200 JSON / 空对象 / HTML / 302 / 403 / 432 / 超时 / 网络错误）下 axios 与 fetch 产出相同 `status` / `data` / header 语义。

### PF3 CredentialResolver（P1）

- `AuthProvider.ts` 提升为 `CredentialResolver.ts`：
  - `Credential`：`id`（非敏感）/ `mode` / `getHeaders()` / `refresh?()`。
  - `CredentialResolver.resolve(ctx)` + `report?()`。
  - 默认 `SingleCredentialResolver`，内部仍包装 `AuthService` / `GuestTokenService`。
- `AuthContext` 暴露 `getCredential(auth, ctx)`；cookie / guest / none 三态行为不变。
- telemetry / 错误 context 增加 `credential_id`（不含 Cookie 明文）。
- 补齐 `likes.list` 的 `accountScoped: true`。

### PF4 插件管线（P1）

新增 `src/services/internal/plugins/`：

- `types.ts`：`WeiboPlugin` / `RequestContext` / `ResponseContext` / `RetryContext` / `ErrorContext` / `WeiboEvent`。
- `pipeline.ts`：排序 + 编译；无插件时 identity 快路径；重名 / `apiVersion` 不兼容直接 `CONFIG_INVALID`。
- `builtin/hooks.ts`：把 `WeiboSDKHooks.onRaw` / `onError` 映射到 `afterResponse` / `onError`；`onFetched` / `onLifecycle` 保持原调用点。
- `builtin/logger.ts`：可选日志观察者示例，不在库入口自动注册。

`FetcherService` 集成点：

| 扩展点 | 时机 | 抛错语义 |
|---|---|---|
| `transport` 中间件 | 每次 `send()` 外层 | fatal，可短路 |
| `beforeRequest` | 鉴权头注入后、发送前 | fatal，可改 headers / query / body |
| `afterResponse` | 收到响应、okPolicy 前 | fatal，v1 只读 |
| `beforeRetry` | 已决定重试、sleep 前 | fatal，可改延迟 / 阻止重试 |
| `onError` | 终态错误抛出前 | fatal，可替换错误 |
| `observe` | 事件发出时 | 吞掉，不影响请求 |

- `IWeiboConfig.plugins?: WeiboPlugin[]`。
- `IWeiboConfig.logging` 删除。

### PF5 包完整性门禁（P1）

- `package.json`：`engines`、`exports` 条件对象、`sideEffects: false`（CLI 拆分后成立）。
- `tsdown.config.ts`：新增 `src/cli-bin.ts` 入口；`./cli` 指向纯命令树。
- 新增脚本：
  - `lint:package`：`publint` + `@arethetypeswrong/cli --pack`。
  - `verify:package`：`pnpm pack` + 临时解包 + Node import + CLI `--version`。
  - `test:bundle`：Vite 程序化打包 + tree-shaking 断言 + Worker smoke。
- 更新 `tests/unit/entry/exports.test.ts`。

### PF6 零配置 DX 收口（P2，文档为主）

- 新增 `docs/engineering/plugins.md`（插件 API、上下文、顺序、错误语义、示例）。
- `README` / `playground` / `AGENTS.md` 增加 `transport` / `plugins` 示例。
- 默认值表与 research §6.2 对齐；不新增 CLI flag。

## 文件布局

```
src/services/internal/transport/
  types.ts
  AxiosTransport.ts
  FetchTransport.ts
  index.ts
src/services/internal/plugins/
  types.ts
  pipeline.ts
  builtin/hooks.ts
  builtin/logger.ts
src/services/internal/CredentialResolver.ts   # 由 AuthProvider.ts 提升
src/cli.ts                                    # 命令树导出（无副作用）
src/cli-bin.ts                                # runMain（bin 入口）
scripts/verify-package.mjs
scripts/lint-package.mjs
scripts/test-bundle.mjs
```

## 测试计划（默认离线）

| 层级 | 用例 |
|---|---|
| Unit | transport 请求构造 / header 小写 / query 序列化 / JSON 与文本响应 / 超时 |
| Unit | `CredentialResolver` 选择、`credential_id` 稳定且不含明文 |
| Unit | 插件排序（pre/normal/post）、重名报错、`apiVersion` 校验、`beforeRetry` 改延迟 / 阻止 |
| Component | fake transport 驱动完整 `request()`；432 → 暂停 + 重试；403 / 302 / HTML → guest 刷新一次 |
| Contract | axios / fetch 对同一组响应产出相同 `status` / `data` / header 语义 |
| Component | 无插件快路径与有插件路径行为一致；observer 抛错不影响请求 |
| Package | `exports` 条件解析、tarball 结构、CLI 拆分后 `sideEffects` 一致 |

## 交付顺序与提交计划

1. `docs: plan plugin architecture implementation`（本文件 + backlog / 日志 / 技术规格同步）
2. `refactor(http): extract transport port from fetcher`
3. `feat(http): add fetch transport and share fetch with guest tokens`
4. `test(http): add transport contract tests`
5. `refactor(auth): introduce credential resolver port`
6. `feat(plugins): add ordered lifecycle plugin pipeline`
7. `docs: document plugin api and defaults`
8. `chore(package): add exports types, engines and side effects allowlist`
9. `refactor(cli): split command tree from bin entry`
10. `test(package): verify packed artifact and tree shaking`

> 每个 commit 独立可回滚；PF1–PF4 默认路径必须保持 `new WeiboSDK({})` 零配置可用。

## DoD

- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm test --run` 离线全绿（E2E 保持门控）
- [ ] `pnpm run lint` 无新增问题
- [ ] `pnpm build` 通过；`dist/index.mjs`、`dist/index.d.mts`、`dist/browser.mjs`、`dist/cli.mjs`、`dist/cli-bin.mjs` 均存在
- [ ] `new WeiboSDK({})` 仍为访客身份；Cookie 模式行为不变
- [ ] axios / fetch transport contract tests 全绿
- [ ] 无插件时请求行为与改造前一致（断言 hooks / telemetry 事件序列）
- [ ] 同名插件 / 不兼容 `apiVersion` 抛 `CONFIG_INVALID`
- [ ] observer 抛错不影响请求；生命周期钩子抛错 fatal
- [ ] `config.hooks` / `config.telemetry` 现有用法不破坏
- [ ] `exports` 使用 `types` 条件；`engines` 与 `process.getBuiltinModule` 要求一致
- [ ] CLI 拆分后 `import '@chilfish/weibo-sdk/cli'` 无顶层副作用
- [ ] 文档与代码一致（technical-spec / architecture / backlog / development-log）

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| axios / fetch 语义漂移 | contract tests；默认仍 `AxiosTransport` |
| 插件顺序 / 错误语义不清 | 文档 + 测试固定 `pre → normal → post`；observer 与 lifecycle 分离 |
| 热路径性能回归 | 无插件 identity 快路径；空数组不构造上下文 |
| 包配置破坏下游 | 先加 `types` 条件与真实 tarball 测试；`sideEffects` 保持 `false` 仅在 CLI 拆分后 |
| 并行 Agent 冲突 | 文件分配互不重叠；核心 `FetcherService` 串行改造，外围测试 / 包门禁并行 |

## 并发分工

| 工作流 | 文件范围 | 依赖 |
|---|---|---|
| A：Transport 端口 + Fetcher 集成 | `src/services/internal/transport/**`、`FetcherService.ts`、`config.ts`、`GuestTokenService.ts` | 无 |
| B：CredentialResolver | `src/services/internal/CredentialResolver.ts`、`AuthProvider.ts` 删除、`WeiboSDK.ts` 引用 | A 完成后 |
| C：插件管线 | `src/services/internal/plugins/**`、`FetcherService.ts` | B 完成后 |
| D：包完整性门禁（并行） | `package.json`、`tsdown.config.ts`、`src/cli.ts`、`src/cli-bin.ts`、`scripts/*`、`tests/unit/entry/exports.test.ts` | 无 |
| E：测试 / 文档（并行） | `tests/component/internal/TransportContract.test.ts`、`tests/testkit/fakeFetch.ts`、`docs/engineering/plugins.md` | A / C 接口稳定后 |
