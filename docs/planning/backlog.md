# 任务清单（Backlog）

**用途**: 收拢各已完成阶段「本版不做」的任务，作为后续阶段候选。新阶段从本清单挑选，承接后在此标注状态，完成后移入「已完成/已承接」。

**状态图例**: 🟢 可承接 → ⏸️ 暂缓（随时可承接）→ ❌ 已移除（产品决策，不再做）

> 来源编号引用 [review-apple-design-2026-08-09.md](../reviews/review-apple-design-2026-08-09.md)（F/C/E/D）与 [todo-archive-mvp.md](../archive/todo-archive-mvp.md)（A/C/E/F）、[review-apple-design-2026-08-10.md](../reviews/review-apple-design-2026-08-10.md)（K/R）。

## 当前方向

**0.1.0 + 0.2.0 已完成并归档（2026-10-20）**——上一阶段行动计划 [todo-post-0.1.0.md](../archive/todo-post-0.1.0.md) 已完成：发布收口、用户数据面、归档媒体 / 增量 / 批量、契约字段、可靠性与 DX 全部收口。**当前没有进行中的阶段计划**；下一阶段从下方「候选任务」挑选，承接后新建 `docs/planning/todo-<stage>.md`。发布细节见 [release-checklist.md](../engineering/release-checklist.md)；同类项目调研见 [research-weibo-ecosystem-2026-10-19.md](./research-weibo-ecosystem-2026-10-19.md)。

> **2026-10-20 方向更新**：重新评估无登录访客模式。真实探针确认 guest 可覆盖「单条 / 评论 / 转发 / 媒体 / 热搜 / 超话 / 资料 / 搜索」等公开读，但 **m 站 container 列表匿名只有第一页**，完整归档仍需 Cookie。方案与行动项见 [research-guest-mode-2026-10-20.md](./research-guest-mode-2026-10-20.md)；产品边界为「显式 guest，不静默降级」。**实施计划见 [todo-guest-mode.md](./todo-guest-mode.md)**（G1–G4 / G6 / G7 已承接，G5 仍待产品确认）。
>
> **2026-10-21 方向更新**：新增「插件化 / 传输适配 / 包完整性」候选方向。结论：**不做多账号 token 池**；采用 Ports → Core → Plugins 三层扩展，先抽 `WeiboTransport`，再补 `CredentialResolver` 与插件管线。调研见 [research-plugin-architecture-2026-10-21.md](./research-plugin-architecture-2026-10-21.md)，下游产物门禁见 [package-integrity.md](../engineering/package-integrity.md)。**已承接为阶段计划 [todo-plugin-architecture.md](./todo-plugin-architecture.md)**（PF1–PF6 实施中）。

> 背景：`@chilfish/weibo-sdk` 发布为 npm 包（CLI `weibo-cli`），`ITweet` 定为 Weibo-archiver 存档终局契约。见 [review-apple-design-2026-08-10.md](../reviews/review-apple-design-2026-08-10.md)。

---

## 候选任务

### 契约与设计债（暂缓）

| # | 任务 | 状态 | 优先级 | 说明 | 来源 |
|---|---|---|---|---|---|
| C5 | 错误分类统一（level 与类名解耦） | ⏸️ | P2 | `level` 由实例声明而非类继承决定，两套真相；选一个明显且唯一的系统 | review C5 |
| E1 | 框架层瘦身评估 | ⏸️ | P2 | EndpointSpec/IResource 是否过度泛化：先承接 P0 契约卫生（消 `as any`、schema 回归）后，用真实使用量评估抽象是否成立 | review E1 |
| — | 领域模型继续精确化 | ⏸️ | P2 | 更多变种字段（`annotations` 异构、`page_info` 类型漂移）的 fallback 链补充，随真实 fixture 驱动 | 渐进式开发计划 Phase 2 |

### 端点扩展（暂缓，非归档优先）

| # | 任务 | 状态 | 优先级 | 说明 | 来源 |
|---|---|---|---|---|---|
| — | 搜索能力增强 | ❌ | — | 依赖公开关键词搜索；产品暂缓，暂不做 | 2026-10-19 产品裁定 |
| — | **公开关键词搜索恢复** | ⏸️ **产品暂缓** | — | **2026-10-19 产品裁定**：官方微博搜索体验差、逆向收益低，公开关键词搜索先放放。注意与「个人主页内搜索自己的微博」区分——`searchProfile`（`searchByDate`）仍可用且属于归档主线。现状：`searchUsers`/`searchTweets` 抛 `UnexpectedAPIResponseError`（`API_BAD_RESPONSE`）；若未来恢复，再评估 SSR HTML / 独立登录态方案 | 2026-10-19 维护者裁定 + 2026-08/10 验证 |
| — | 私信/消息能力 | ❌ | — | 超出「公开数据归档」范围且敏感，**产品决策不做** | todo-archive-mvp 定位 |

### DX 与可观测性（暂缓）

| # | 任务 | 状态 | 优先级 | 说明 | 来源 |
|---|---|---|---|---|---|
| — | Isomorphic 环境验证 | 🟢 承接 PF2 | P3 | 浏览器/Node/Edge 双环境兼容验证（`axios` 依赖能否替换为原生 `fetch` 的无依赖形态）；由 `FetchTransport` + Worker smoke 一并验证 | SKILL.md 第五条 |
| — | 集成测试补位 | ⏸️ | P2 | E2E 已覆盖核心端点（2026-10-19：18 用例全绿）；仍缺更多变体与失败路径；CI 无覆盖率门禁 | 渐进式开发计划 测试策略 |
| — | 错误诊断增强 | ⏸️ | P3 | `error-diagnostics.md` 补决策树（不同 code 的排查路径 + curl 复现） | review 延伸 |
| — | Agent 可发现性（SKILL.md / AGENTS.md） | ✅ | P3 | 已落地 `.agents/skills/weibo-sdk/SKILL.md`（skill-creator 模板）与 `AGENTS.md` 使用速查；`llms.txt` 不适用（不暴露 HTTP 服务） | 2026-10-19 调研 |

### 插件化、传输适配与包完整性（可承接，2026-10-21）

> 依据：[research-plugin-architecture-2026-10-21.md](./research-plugin-architecture-2026-10-21.md)。原则：Ports → Core → Plugins；默认零配置；retry / rate-limit / auth-refresh 不插件化；不做 token 池。

| # | 任务 | 状态 | 优先级 | 说明 | 来源 |
|---|---|---|---|---|---|
| PF1 | Transport 端口（`WeiboTransport` + `AxiosTransport`） | ✅ 已完成 | P0 | 抽出 `send()` 契约；HTTP 状态正常返回，仅网络/超时抛错；`sendAttempt` 不再改写 `resource.headers`；现有测试零行为变化 | research §5.2 / §8 |
| PF2 | `FetchTransport` + `GuestFetch` 合并 | ✅ 已完成 | P1 | 可注入 fetch，覆盖 Worker / Edge / Deno / Bun；guest token 发放复用同一 fetch；补 transport contract tests | research §5.2 |
| PF3 | `CredentialResolver` + `credential_id` | ✅ 已完成 | P1 | 默认单凭证包装 `AuthService` / `GuestTokenService`；不做池；`likes.list` 按目标 uid 读取，不标记 `accountScoped` | research §5.3 / ADR-015 |
| PF4 | 插件管线 + 兼容层 | ✅ 已完成 | P1 | `plugins` 数组、`pre/normal/post` 排序、transport 中间件、只读 observer；`hooks` / `telemetry` 保留语义；删除 `logging` 死配置 | research §5.4 |
| PF5 | 包完整性门禁 | ✅ 已完成 | P1 | `publint` + `attw` + `pnpm pack` 临时安装 + Vite/esbuild + tree-shaking + Worker smoke；修 `exports#types` / `sideEffects` / `engines` | ADR-016 / [package-integrity.md](../engineering/package-integrity.md) |
| PF6 | 零配置 DX 收口 | ✅ 已完成 | P2 | 默认值表、README / playground / SKILL 示例；`pnpm play plugins` 离线演示；`new WeiboSDK({})` 零配置可用 | research §6 |
| PF7 | 凭证池外置插件 | ⏸️ | P3 | 仅在「多账号 + 多代理 + 高吞吐归档」明确需求时启动；强制 `accountScoped` pin 主账号 | research §3.4 |

### 扩展点候选（2026-10-21）

> 依据：[plugins.md](../engineering/plugins.md) §8 当前能力矩阵 / §9 后续候选。原则：只加可选端口与钩子，不改默认路径；不开放 retry / rate-limit / auth-refresh 顺序。

| # | 任务 | 状态 | 优先级 | 说明 |
|---|---|---|---|---|
| EX1 | 端点级插件作用域（`endpoints` / `when`） | 🟢 | P2 | 缓存 / mock / 签名只对部分端点生效，避免用户在每个 hook 里手写 `if` |
| EX2 | `credentialResolver` 配置化 | 🟢 | P1 | 暴露已有 `CredentialResolver` 端口；默认单凭证；`accountScoped` 必须 pin 主凭证 |
| EX3 | 内置缓存 / single-flight 插件 | 🟢 | P2 | `cachePlugin({ ttlMs, key })` 参考实现，不默认启用；缓存键含 query 与凭证维度 |
| EX4 | `ArchiveStore` 端口 | 🟢 | P2 | `loadCheckpoint` / `saveCheckpoint` / `saveItem`，接 SQLite / S3 / IndexedDB |
| EX5 | `MediaStore` / 下载器端口公开配置 | 🟢 | P2 | 把 `MediaServiceDownloadDeps` 的 `http` / `fileStore` 提升为公开配置 |
| EX6 | `RateLimiter` 端口 | ⏸️ | P3 | 多实例 / 分布式共享令牌桶；432 全局暂停语义必须保留 |
| EX7 | `afterValidate` 只读钩子 | ⏸️ | P3 | Zod 成功后的指标 / 采样；**不提供** `transformResponse`，避免掩盖 schema 漂移 |
| EX8 | 插件 `onInit` | ⏸️ | P3 | 构造期末尾校验 / 预热；仍不提供 `sdk.use()` 热插拔 |
| EX9 | 请求上下文透传（`traceId` / `tenantId`） | ⏸️ | P3 | 让 `beforeRequest` 拿到调用方标识；telemetry 仍保持扁平 KV |
| — | 运行时注册新端点 / 绕过 Zod / 写操作插件 | ❌ | — | 与「契约稳定 + 只读」边界冲突，不做 |

### 访客模式（Guest Mode，可承接）

> 依据：[research-guest-mode-2026-10-20.md](./research-guest-mode-2026-10-20.md)。原则：单一移动端访客 token；显式 `auth: 'auto' | 'cookie' | 'guest'`；Cookie 失效不静默降级；账号级能力继续要求 Cookie。

| # | 任务 | 状态 | 优先级 | 说明 | 来源 |
|---|---|---|---|---|---|
| G1 | 鉴权基础设施（`GuestTokenService` / `AuthProvider` / `auth` 配置） | ✅ 已完成 | P0 | 移动端 `genvisitor → incarnate`；JSONP + Set-Cookie 双解析；缓存 + single-flight；失败分类与一次刷新 | research §5 |
| G2 | `EndpointSpec.auth` + Fetcher 按端点选凭据 | ✅ 已完成 | P0 | 默认 `cookie`；`none` / `guest` 显式声明；302 / `ok:-100` / 403 / `{}` / HTML / 432 统一分类 | research §5.5–5.6 |
| G3 | 自检 / `getSession` guest 分支 + 归档守卫 | ✅ 已完成 | P0 | guest 不调用 `myDetails`；`sessionUid=undefined`；归档在 guest 下抛 `CONFIG_INVALID` | research §5.7 / §5.11 |
| G4 | m 站第一页端点（timeline / likes / followings / fans / video / album） | ✅ 已完成 | P1 | 独立 mobile spec；Service 按 `authMode` 分支；显式标注 `first_page`；媒体 / 相册继续走可翻页的 PC 端点 | research §3.4 / §5.10 |
| G5 | 搜索能力重估 | ⏸️ 待产品确认 | P1 | guest 下 type=1/3 可用但不稳定；是否把 `search.*` 从 `unavailable` 改 `degraded` | research §9.4 |
| G6 | CLI `--guest` + capabilities 输出 | ✅ 已完成 | P1 | 不读 `.env` Cookie；`whoami --guest` 输出访客身份；能力表带 `guestPagination` | research §5.8–5.9 |
| G7 | guest fixtures + E2E smoke | ✅ 已完成 | P2 | 默认离线；`WEIBO_GUEST_E2E=1` 独立门控；432 记 skip | research §7 |

---

## 已移除（产品决策）

| 任务 | 原因 | 日期 |
|---|---|---|
| 私信/消息能力 | 超出「公开数据归档」范围，且涉及他人隐私数据 | 2026-08-09 |
| D6 音频播放列表端点 | 单条 `ITweet.audio` 已支持；播放列表接口缺真实样本，维护者裁定不再推进 | 2026-10-20 |
| D15 转发历史独立端点 | 候选路径已失效；继续用 `mymblog` + 转发过滤即可 | 2026-10-20 |
| 定时 E2E canary / `--detail compact\|full` / CI 端点 checklist / MCP server / 导出适配器 / 多账号登录态隔离 / 二维码登录 / Docker 示例 | 0.2 阶段收尾时维护者裁定不再推进 | 2026-10-20 |
| 多账号 token 池轮换 | 账号级端点会改变数据；非账号级 cookie 端点受可见范围影响；guest 池受 IP 风控限制且额外发 token 请求；与「只使用自己的账号 Cookie」边界冲突。保留 `CredentialResolver` 接缝与 `credential_id` 观测 | 2026-10-21 |

## 已完成/已承接

| 任务 | 状态 | 承接 |
|---|---|---|
| P0 契约一致性（版本单一来源 / `sinceId` 对齐 / 合并 cli-gap-fill） | ✅ 已完成 | 归档 MVP（[archive](../archive/todo-archive-mvp.md)） |
| 归档链端点（repostTimeline / 粉丝列表 / favorites-tags） | ✅ 已完成 | 归档 MVP（[archive](../archive/todo-archive-mvp.md)） |
| ArchiveService 断点续传流 + 全链路快照 + CLI 归档 | ✅ 已完成 | 归档 MVP（[archive](../archive/todo-archive-mvp.md)） |
| 契约卫生（消 `as any` / 变种测试 / schema 回归 / 收窄双 API） | ✅ 已完成 | [todo-contract-freeze.md](../archive/todo-contract-freeze.md) P0-4/P0-5、P1-8 |
| telemetry 消费端 / CLI 裁剪 / 流程简化 / TSDOC / 快速开始示例 | ✅ 已完成 | [todo-contract-freeze.md](../archive/todo-contract-freeze.md) P2 |
| raw / enrich 访问策略（K5） | ✅ 已完成 | [todo-contract-freeze.md](../archive/todo-contract-freeze.md) P1-9（`hooks.onRaw` / `streamArchive({ onRaw })` / `tweets.enrich`） |
| 媒体下载辅助（单条微博） | ✅ 已完成 | `sdk.media.downloadTweetMedia` / `weibo-cli media download`；不改 `ITweet`/`ArchiveItem`（2026-10-20） |
| 432 风控信号与退避 / 请求级重试 | ✅ 已完成 | [todo-post-0.1.0.md](../archive/todo-post-0.1.0.md) §4（`RateLimitError` / `RetryPolicy` / 令牌桶暂停） |
| 评论回复树 / 二级评论分页 | ✅ 已完成 | `tweets.replies` / `streamReplies`（D13，2026-10-20） |
| Agent 可发现性（`.agents/skills/weibo-sdk/SKILL.md` / `AGENTS.md`） | ✅ 已完成 | `.agents/skills/weibo-sdk/SKILL.md` + `AGENTS.md` 使用速查；`capabilities()` / CLI JSON 错误信封（2026-10-20；不提供 `llms.txt`） |
| 0.2 用户数据面（D1–D13） | ✅ 已完成 | 点赞 / 历史评论 / 收藏流 / 媒体 / 点赞者 / @我 / 通知 / 分组 / 超话 / 关键词 / 二级评论；见 [todo-post-0.1.0.md](../archive/todo-post-0.1.0.md) |
| 访客模式（G1–G4 / G6 / G7） | ✅ 已完成 | [todo-guest-mode.md](./todo-guest-mode.md)：显式 `auth` 模式、访客 token、端点鉴权声明、m 站第一页、CLI `--guest`、真实 fixtures 与 E2E smoke（2026-10-20） |
| 归档扩展（媒体 / 增量 / 批量 / 仅原创 / 状态文件） | ✅ 已完成 | `streamArchive` / `streamUsersArchive` / `archiveState`（2026-10-20） |

> 各阶段交付细节见 [development-log/](../development-log/README.md)；完成后移入 [archive/](../archive/README.md)（存档不主动读取）。
