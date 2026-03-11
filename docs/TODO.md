# TODO / Next Steps (TDD-first)

> 原则：每个功能都有对应测试用例；默认测试必须离线可跑（不依赖真实微博网络 IO）。

## 0. 仓库一致性与“文档即事实”

- [ ] 对齐 README 与实际目录结构（当前 `pnpm-workspace.yaml` 指向不存在的 `packages/ examples/ playground/`）。
- [ ] 移除库入口副作用（例如 `src/index.ts` 的 `console.log`），并用测试防止回归。
- [ ] 统一导出面：`src/index.ts` 与 `src/types/index.ts` 导出 domain/raw/errors 等公共契约。

## 1. 测试基座与分层策略（先立规矩）

- [ ] 约定并落实测试分层：
  - `tests/unit/**`：纯函数/模型/类型映射（0 IO）
  - `tests/component/**`：Fetcher/Auth/RateLimit 等边界模块（mock HTTP/clock/sleep）
  - `tests/e2e/**`：需要真实 Cookie/真实网络（默认跳过，显式开启）
- [ ] 修正当前“集成测试脚本化”的问题：`tests/integration/user.test.ts` 应变为真正的 `describe/it` 并默认跳过真实外网。
- [ ] 为公共 exports 添加回归测试（防止未来 breaking / tree-shaking 问题）。

## 2. Contract First：契约、命名与兼容性

- [ ] 对齐文档与代码中的命名/字段（例如 `User` 的 `realName` vs domain `real_name`）。
- [ ] 公共 API 先写类型/接口与行为约束，再实现（SDD）。
- [ ] 语义化版本与弃用策略：Breaking Change 必须可发现（文档 + 类型层约束）。

## 3. Internal 基础设施可测性改造（离线测试的前提）

### 3.1 FetcherService（HTTP 边界）

- [ ] 解耦 axios：支持注入 `AxiosInstance` 或抽象 `HttpClient`，默认使用 axios.create。
- [ ] 单测覆盖：
  - [ ] request 拦截器注入 Cookie/XSRF
  - [ ] 代理/超时配置
  - [ ] 错误映射：超时 -> `ConnectionTimeoutError`；其他 -> `NetworkRequestError`（含 status/data）
  - [ ] `onFetched`/telemetry 在成功路径被调用（并收紧类型，避免 `any`）

### 3.2 RateLimitService（时间/睡眠边界）

- [ ] 注入 `now()` 与 `sleep(ms)`，支持 fake clock。
- [ ] 单测覆盖 token 消耗、等待、refill 逻辑。

### 3.3 AuthService（认证边界）

- [ ] 单测覆盖：
  - [ ] 从 cookie 提取 XSRF-TOKEN
  - [ ] validate 规则（SUB=）
  - [ ] header 注入优先级（显式 xsrfToken vs cookie 提取）

## 4. UserService & User Model（当前唯一业务闭环）

- [ ] `UserService` 组件测试（mock HTTP）：
  - [ ] `info/details` 的 URL/params/referer 与 `onFetched(resource, data)` 调用
  - [ ] `getById` 并发聚合与异常传播行为
- [ ] `User` 归一化单测（fixtures 驱动）：
  - [ ] avatar fallback 优先级
  - [ ] ip_location 去前缀规则
  - [ ] stats/verification/扩展字段缺失时的默认策略

## 5. TweetService / SearchService（从空文件到最小可用闭环）

- [ ] 扩展 `types/resources.ts` 资源映射与 raw schema 覆盖。
- [ ] Tweet：先实现“获取用户微博列表”（已有 raw tweet schema），返回标准化 `ITweet`。
- [ ] Search：实现一个最小搜索 API（分页/游标明确），并提供离线测试。
- [ ] 为每个 service 补齐 normalize 的纯单测 + mock HTTP 的组件测试。

## 6. Wide Events（可观测性落地）

- [ ] 定义统一 `TelemetryEvent`（扁平 KV，含 `event_name/timestamp/trace_id` 与关键上下文）。
- [ ] 关键路径打点：request_start/success/error、rate_limit_wait、normalize_done。
- [ ] 测试中可断言事件序列与字段完整性。
