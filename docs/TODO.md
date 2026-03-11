# TODO / Next Steps (TDD-first)

> 原则：每个功能都有对应测试用例；默认测试必须离线可跑（不依赖真实微博网络 IO）。

## 0. 仓库一致性与“文档即事实”

- [x] 对齐 README 与实际目录结构（移除错误的 monorepo 描述）。
- [x] 移除库入口副作用（`src/index.ts` 不再 `console.log`），并用测试防止回归。
- [x] 统一导出面：`src/index.ts` 与 `src/types/index.ts` 导出 domain/raw 等公共契约。

## 1. 测试基座与分层策略（先立规矩）

- [x] 约定并落实测试分层：
  - `tests/unit/**`：纯函数/模型/类型映射（0 IO）
  - `tests/component/**`：Fetcher/Auth/RateLimit 等边界模块（mock HTTP/clock/sleep）
  - `tests/e2e/**`：需要真实 Cookie/真实网络（默认跳过，显式开启）
- [x] 修正“集成测试脚本化”的问题：迁移到 `tests/e2e/*`，用 `WEIBO_E2E=1` 显式开启。
- [x] 为 `package.json#exports` 添加回归测试（防止未来 breaking / tree-shaking 问题）。

## 2. Contract First：契约、命名与兼容性

- [x] 对齐文档与代码中的命名/字段（`realName` camelCase）。
- [ ] 公共 API 先写类型/接口与行为约束，再实现（SDD）。
- [ ] 语义化版本与弃用策略：Breaking Change 必须可发现（文档 + 类型层约束）。

## 3. Internal 基础设施可测性改造（离线测试的前提）

### 3.1 FetcherService（HTTP 边界）

- [x] 解耦 axios：支持注入 `AxiosInstance/Auth/RateLimit`，默认使用 axios.create。
- [x] 单测覆盖 request 注入/错误映射等核心路径。
- [x] 引入 SDK hooks（`onLifecycle/onFetched/onError`）与 preflight 自检（lazy/eager），降低“用户忘记 selfCheck / cookie 过期读到 undefined”的概率。
- [x] 引入 `EndpointSpec + request(spec)`：统一处理 ok!=1 / schema 校验 / hooks emission，减少业务层样板代码。
- [x] 引入 Zod schema 验证：协议层集中产出可诊断的 `API_BAD_RESPONSE`（含 `zodIssues`）。
- [ ] 定义并实现 telemetry（Wide Events）接口，并逐步弃用 `service.onFetched` 的弱类型回调。

### 3.2 RateLimitService（时间/睡眠边界）

- [x] 注入 `now()` 与 `sleep(ms)`，支持 fake clock。
- [x] 单测覆盖 token 消耗、等待、refill 逻辑。

### 3.3 AuthService（认证边界）

- [x] 单测覆盖从 cookie 提取 XSRF、validate（SUB=）、header 优先级。
- [x] 配置校验错误结构化：缺 cookie 抛 `InvalidConfigError`。

## 4. UserService & User Model（当前唯一业务闭环）

- [x] `UserService` 组件测试（mock HTTP）：覆盖 endpoint/params/referer 与 `onFetched` 调用。
- [x] `User` 归一化单测：avatar fallback、IP属地前缀、stats/扩展字段映射。

## 5. TweetService / SearchService（从空文件到最小可用闭环）

- [x] 扩展 `types/resources.ts` 资源映射与 raw schema 覆盖（含 `TWEET_MYMBLOG`）。
- [x] Tweet：实现“获取用户微博列表”（mymblog），并完成 `Tweet` 归一化 v1（media/page/geo/retweeted）。
- [ ] Tweet：分页/游标策略（`since_id`、置顶/广告过滤、长文/卡片分支）与对应测试。
- [ ] Search：实现一个最小搜索 API（分页/游标明确），并提供离线测试。

## 6. Wide Events（可观测性落地）

- [ ] 定义统一 `TelemetryEvent`（扁平 KV，含 `event_name/timestamp/trace_id` 与关键上下文）。
- [ ] 关键路径打点：request_start/success/error、rate_limit_wait、normalize_done。
- [ ] 测试中可断言事件序列与字段完整性。

## 7. Zod / Spec 工程化（可维护性 + DX）

- [ ] 将 schema/spec 从 Service 文件中抽离到 `src/services/endpoints/**`（或等价目录），避免 Service 里出现大量协议细节。
- [ ] 逐步用 `z.infer<typeof Schema>` 替代手写 `types/raw/**`（先从 `USER_*` / `TWEET_SHOW` 开始），减少 `as unknown as`。
- [ ] 明确 schema 的“strictness 策略”：默认 `.passthrough()`，只对稳定关键字段做强约束；对于易变字段用 `unknown` 留白。
- [ ] 将 `EndpointSpec` 的 args 类型改为“由 args schema 推导”（减少 `Record<string, unknown>` 与类型断言），并提供 `defineEndpoint()` helper。
- [ ] 输出“错误排障手册”：Zod issues、ok!=1、cookie 过期、网络错误的诊断流程（贴合 hooks + Structured Error）。
