# TODO / Next Steps (TDD-first)

> 原则：每个功能都有对应测试用例；默认测试必须离线可跑（不依赖真实微博网络 IO）。

---

## 优先级说明

- 🔴 P0：阻塞当前可用性或涉及仓库一致性
- 🟡 P1：功能推进（直接扩展 SDK 能力）
- 🟢 P2：工程优化（DX / 可维护性 / 文档）

---

## P0：仓库一致性与文档

- [ ] **README 去伪存真**：移除不存在的 `packages/*`、`examples/` 目录引用；修正 `pnpm --filter @weibo-sdk/core` 等 monorepo 遗留指令；修正分支命名（`codex/` 而非 `feature/`）；更新特性列表（补 Wide Events / Zod 校验 / selfCheck）。
- [ ] **docs/渐进式开发计划.md** 标注各阶段完成状态，避免被误读为"全部未做"。
- [ ] 输出"错误排障手册"（`docs/error-diagnostics.md`）：Zod issues、ok!=1、Cookie 过期、网络错误的诊断流程，贴合 hooks + Structured Error。

---

## P1：功能推进

### Tweet 服务完善
- [ ] 分页策略：`since_id` 游标、置顶/广告过滤、长文/卡片分支逻辑 + 对应离线测试。
- [ ] `Tweet` 归一化 v2：抽取 `normalizeTweet(raw)` 纯函数，降低构造器复杂度，便于复用与单测。
- [ ] 新增 endpoint：评论列表（`/ajax/statuses/buildComments`）与转发列表，含分页。

### Search 服务
- [ ] 实现最小搜索 API（微博搜索 / 用户搜索），明确分页/游标策略，并提供离线测试。
- [ ] 定义 search raw types + Zod schema + EndpointSpec。

### 流式接口
- [ ] 基于 AsyncIterator 的用户时间线 / 搜索结果流式获取。

---

## P2：工程优化

### Zod / Schema 迁移
- [ ] 用 `z.infer<typeof Schema>` 逐步替代手写 `types/raw/**`，从 `USER_INFO` / `USER_DETAILS` / `TWEET_SHOW` 开始，减少 `as unknown as`。
- [ ] 明确 schema strictness 策略：默认 `.passthrough()`（开放端点模式），仅对稳定关键字段做强约束；易变字段用 `unknown` 保留。
- [ ] 为所有 endpoint 补充 args schema（当前 `myDetailsSpec` 的 args 为 `undefined`，需要确认是否加入 Zod schema）。

### 可观测性与测试
- [ ] 将 `normalize_done` 事件的 `trace_id` 与上级请求的 `trace_id` 串联（而非独立生成），形成完整追踪链。
- [ ] 扩大 telemetry 测试的覆盖范围：覆盖 FetcherService 的 preflight error / parse error 路径。
- [ ] `tests/testkit/` 扩展：添加通用 fake clock、fake sleep，减少各测试重复定义。

### CI / 构建
- [ ] 配置 CI（GitHub Actions）：`pnpm install` → `pnpm run typecheck` → `pnpm run lint` → `pnpm test`。
- [ ] 配置 `size-limit` 或 bundle 体积检查，防止依赖膨胀。
- [ ] 配置 `pkg.pr.new` 或等价方案，让 PR 产生可安装的预览包。

### 开发者体验
- [ ] 补充公共 API 的 TSDoc 注释（当前仅部分方法有注释）。
- [ ] 在 `package.json#exports` 中暴露子路径（如 `weibo-sdk/testing` 导出 testkit），方便下游测试。

---

## 已完成 ✓

<details>
<summary>展开查看已完成的条目</summary>

### 0. 仓库一致性与"文档即事实"
- [x] 对齐 README 与实际目录结构（移除错误的 monorepo 描述）。
- [x] 移除库入口副作用（`src/index.ts` 不再 `console.log`），并用测试防止回归。
- [x] 统一导出面：`src/index.ts` 与 `src/types/index.ts` 导出 domain/raw 等公共契约。

### 1. 测试基座与分层策略
- [x] 约定并落实测试分层：unit / component / e2e。
- [x] 迁移集成测试脚本到 `tests/e2e/*`，用 `WEIBO_E2E=1` 显式开启。
- [x] 为 `package.json#exports` 添加回归测试。

### 2. Contract First
- [x] 对齐文档与代码中的命名/字段（`realName` camelCase）。

### 3. Internal 基础设施可测性改造
- [x] FetcherService 解耦 axios：支持注入 `AxiosInstance/Auth/RateLimit`。
- [x] FetcherService 单测覆盖 request 注入/错误映射等核心路径。
- [x] 引入 SDK hooks（`onLifecycle/onFetched/onError`）与 preflight 自检（lazy/eager）。
- [x] 引入 `EndpointSpec + request(spec)`：统一处理 ok!=1 / schema 校验 / hooks emission。
- [x] 引入 Zod schema 验证：协议层集中产出可诊断的 `API_BAD_RESPONSE`（含 `zodIssues`）。
- [x] 定义并实现 telemetry（Wide Events）接口。
- [x] RateLimitService 注入 `now()` 与 `sleep(ms)`，支持 fake clock。
- [x] RateLimitService 去递归（while 循环替代递归等待）。
- [x] AuthService 单测覆盖。

### 4. UserService & User Model
- [x] UserService 组件测试（mock HTTP）：覆盖 endpoint/params/referer 与 hooks 调用。
- [x] User 归一化单测：avatar fallback、IP 属地前缀、stats/扩展字段映射。

### 5. TweetService
- [x] 扩展 `types/resources.ts` 资源映射与 raw schema 覆盖（含 `TWEET_MYMBLOG`）。
- [x] Tweet：实现 mymblog 列表 + show 详情。
- [x] Tweet 归一化 v1：media/pageInfo/geo/retweetedStatus。

### 6. Wide Events
- [x] 定义统一 `TelemetryEvent`（扁平 KV，含 `event_name/timestamp/trace_id`）。
- [x] 关键路径打点：request_start/success/error、rate_limit_wait、normalize_done。
- [x] 测试中可断言事件序列与字段完整性。

### 7. Zod / Spec 工程化
- [x] 将 schema/spec 从 Service 文件中抽离到 `src/services/endpoints/**`。
- [x] 将 `EndpointSpec` 的 args 类型改为"由 args schema 推导"，并提供 `defineEndpoint()` helper。

</details>
