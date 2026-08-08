# weibo-sdk 设计审查 — Apple 产品与研发视角

**审查日期**: 2026-08-09
**审查范围**: 全仓库（源码 + 文档 + 测试 + 工程流程）
**审查方式**: AI 外部审查（Apple 产品哲学 + 研发纪律双视角）
**分支**: main @ `020c056`
**决策背景**: 产品定位确认为「**个人数据归档**」（2026-08-09 产品决策，见 [todo-archive-mvp.md](../planning/todo-archive-mvp.md)）

> 本档是「锐评」的正式沉淀，也是后续行动计划的依据。行动计划可直接引用本文的问题编号（F / C / E / D）。
> 本文视角借鉴 Apple：聚焦（Focus is saying no）、端到端交付（Own the whole experience）、契约稳定（ABI 是设计原则）、删繁就简（Simplicity is the ultimate sophistication）。

---

## 〇、总评

这是一个**工程纪律远超产品定义**的项目。测试分层、数据驱动开发、结构化错误、Wide Events、postmortem 沉淀、文档即事实——这套「研发文化」已经到产品级，8 份 postmortem 证明团队是被真实数据打服后学到的，非常难得。

但恰恰是这套纪律的深度，暴露了一个系统性盲区：**所有精力都钉在「如何正确地把 raw 变成 domain」，却没有人回答「用户拿这个 SDK 到底要完成哪一件事」。** 6 个 Service、14 个资源类型、15 个端点 spec、CLI 14 个子命令、hooks + telemetry + selfCheck + rate limit……能力列表很长，产品主线很模糊。

**一句话**：这是「一个为端点服务的框架」，不是一个「为一件事服务的产品」。本档的目的不是否定框架质量，而是推动项目从「端点集合」进化为「个人数据归档」这一件事上的深井。

### 分维度评分

| 维度 | 评分 | 一句话 |
|---|---|---|
| 研发纪律（测试/文档/postmortem） | ⭐⭐⭐⭐⭐ | 数据驱动 + 分层测试 + 文档即事实，个人项目里罕见地完备 |
| 数据驱动正确性 | ⭐⭐⭐⭐⭐ | 5 个生产 Bug 全是「合理推断」，已固化为硬约束（ADR-002） |
| 产品聚焦 | ⭐⭐ | 无 hero use case；生熟两套 API 并存，表面翻倍 |
| 契约一致性 | ⭐⭐ | VERSION 三处不一致；`sinceId` 公开类型与真实类型背离 |
| 抽象超前性 | ⭐⭐ | EndpointSpec/IResource 框架写给 100 端点，现状 15 端点且多处 `as any` 绕过 |
| 工程流程 | ⭐⭐⭐ | 仪式感开始压倒产出；CLI Mandate 是流程产物不是产品 |
| 可观测性落地 | ⭐⭐⭐ | Wide Events 协议干净，但无消费端（缺 exporter/示例） |

---

## 一、值得保留的（Apple 也会这么做）

| 决策 | 为什么像 Apple |
|---|---|
| **数据驱动开发**（先抓包、后写 schema） | 在「真实硬件」上开发，而不是在假设上构建。8 份 postmortem 是把这份教训钉死的最好方式。 |
| **EndpointSpec 单一路径** | 一个明显的、可预测的加端点方式，像 Apple 的「one way to do it」。 |
| **测试分层 + 结构快照当漂移检测器**（ADR-011） | Apple 的回归纪律：E2E 失败 = 上游结构变更信号，不是 flaky。 |
| **结构化错误 + Wide Events** | os_log 式的直觉：Happy Path 与 Error Path 都埋点，`emit` 失败不影响 SDK 功能。 |
| **离线测试默认可跑** | 反馈速度 = 迭代安全，Apple 的「simulator first」等价物。 |

---

## 二、问题清单（按严重度）

### 🔴 F — 产品聚焦（当前最大盲区）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| F1 | **没有 hero use case** | 全局 | 6 Service / 15 端点 / CLI 14 子命令，能力齐全但**没有一件事是被做到极致的**。iPhone 第一代只承诺电话/音乐/上网三件事。weibo-sdk 需要一条主线——本档决策为「个人数据归档」。 |
| F2 | **生熟两套 API = 泄漏抽象 + 翻倍维护面** | `TweetService.ts` | `show`/`getByMblogId`、`myMblog`/`listByUserId`、`friendTimeline`/`listFriendTimeline` 几乎每个端点都有 raw + normalized 双胞胎，且 raw 也一级导出。**等于承认「屏蔽易变 raw」这个核心卖点自己也不信**。应设 normalized 为默认、raw 标 `@deprecated` 降级为显式逃生舱。 |
| F3 | **CLI Mandate 是流程产物不是产品** | `CLAUDE.md`、`src/cli.ts` | 「每个 SDK 功能必须 CLI 暴露」让每个功能成本 ×2（SDK + CLI + 测试 + 文档）。但测试基座（TelemetryCollector + fakeAxios）已覆盖可测性。Apple 的 `xcodebuild`/`swift` 是为特定 persona 造的工具，不是每个 API 的镜子。CLI 应裁剪为只服务 hero workflow。 |

### 🟠 C — 契约一致性（公开 API 的可靠性）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| C1 | **VERSION 三处不一致** | `package.json:4` = `0.0.0`；`src/index.ts:2` = `0.1.0`；`src/cli.ts:70` = `0.1.0` | 三份真相源，连版本号都不能自洽。应单一来源（从 `package.json` 读取），并定 semver 策略。 |
| C2 | **公开 API 又踩回自己的 postmortem 雷** | `TweetService.ts:9-13,64` | 真实 `since_id` 是 `string`（postmortem B1 教训），但 `TweetPageResult.sinceId` 公开类型是 `number`，运行时 `Number(raw.data.since_id)` 强转。上游一旦发超过 2^53 的 ID 或带前缀的游标，分页直接断。**类型必须以真实为准——这是项目自己的规则。** |
| C3 | **`args as any` 绕过自己的类型推导** | `TweetService.ts:158,187,204` | `comments()` / `searchByDate()` / `friendTimeline()` 三个方法用 `args as any` 调用 `request(spec, args)`，**argsSchema 的类型安全在这三个调用点全部失效**。框架的承诺被实现自己在破坏。 |
| C4 | **无版本演进机制** | `SKILL.md` 第八条 | 写了「版本演进兼容性（SemVer）」，但代码里无 `@deprecated` 注解、无迁移指南、无 breaking-change 策略。Swift 的 ABI 稳定性是设计原则，不是文档句子。 |
| C5 | **错误分类两套真相** | 规格书 §4.1 | 文档自己承认「`level` 目前与类名解耦」——类继承决定一个维度、实例声明决定另一个维度。应选一个明显且唯一的系统。 |

### 🟡 E — 工程质量与流程

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| E1 | **为还没验证过的规模过早泛化** | `EndpointSpec.ts`、`types/resources.ts` | EndpointSpec/IResource 注册表这套框架层是写给 100 个端点的，现状 15 个。抽象应先由真实需求驱动，而不是先造框架再找需求。 |
| E2 | **`any` 漏网** | `TweetService.ts:37` | `filterTweets(rawList: any[])` 用 `any`，违反 strict 模式约定（CLAUDE.md：「尽量避免 any，无法避免时在边界层集中」）。 |
| E3 | **Phase 3 变种测试仍为空** | `docs/渐进式开发计划.md` | 含视频（`mix_media_info`）/ 含位置（`geo`）/ 含 `continue_tag` / 广告（`isAd`）四类变种测试全是空 checkbox——媒体归一化逻辑（`extractMediaFromMixMediaInfo`）恰恰是最复杂、最可能出错的路径。 |
| E4 | **Telemetry 没有消费者** | `src/types/telemetry.ts` | Wide Events 协议很干净（扁平 KV + trace_id），但无任何 exporter / JSONL 落盘 / 消费示例。一个没有 Instruments 的 os_log。可观测性要有消费端才成立。 |
| E5 | **Phase 4 自动 schema 校验未做** | `docs/渐进式开发计划.md` | `validate-fixtures.ts` 脚本（遍历 fixture × schema safeParse）是「离线契约回归」的关键，目前是一次性设想，未落地为持续回归。 |
| E6 | **仪式感开始压倒产出** | `CLAUDE.md` | docs-first / 先写 commit message / 写码前读雷区清单 / postmortem 模板 / 日志索引 / ADR 记录——对单人 OSS 逆向项目，**流程字数是产品字数的数倍**。危险：项目变成「关于做项目的项目」。Apple 的纪律服务的是用户拿到的体验，不是纸面流程。 |

---

## 三、根因分析（blameless）

对照 8 篇 postmortem 的「跨切片教训」，本档问题的共性是**视角倾斜**，非能力问题：

1. **「正确性」被定义成「schema 与 raw 一致」，而不是「用户完成了一件事」**：数据驱动把「端点正确」做到了极致，但没有问「这些端点合起来，用户能建出什么」。F1/F2/F3 都是「能力视角」压倒「任务视角」的产物。
2. **契约稳定停留在文档层，没有进入类型层**：C1（版本）/ C2（sinceId）/ C4（semver）都是「契约是口号、机制是空的」的表现——postmortem 的教训被写进规则，但没有被写进类型。
3. **流程纪律没有「回流」到简化**：E6 的仪式感是流程只增不减的累积；postmortem 008 记了「并行 Agent 需互不重叠」，但没有一条 postmortem 说「减少流程」。

---

## 四、与 Apple 产品哲学的差距表

| 维度 | Apple 参考 | weibo-sdk（现状） |
|---|---|---|
| 产品定义 | 一个清晰的 hero 场景，做到极致 | 15 端点能力齐全，无主线（F1） |
| 默认路径 | 一个明显的方式 | raw + normalized 双 API 并存（F2） |
| API 稳定 | ABI 是设计原则 + `@deprecated` 存续期 | 无版本策略、公开类型背离真实（C1/C2/C4） |
| 工具 | 为特定 persona 造工具 | CLI 对称镜像所有 API（F3） |
| 可观测性 | os_log + Instruments | Wide Events 协议无消费端（E4） |
| 流程 | 纪律服务体验 | 流程字数是产品字数的数倍（E6） |

---

## 五、行动优先级（依据）

> 行动项已落到 [todo-archive-mvp.md](../planning/todo-archive-mvp.md)（产品主线）与 [backlog.md](../planning/backlog.md)（候选任务），此处只给方向。

**P0（立即）**：C1 版本单一来源、C2 `sinceId` 对齐真实类型、F1 产品定位决策（已定：个人数据归档）。

**P1（产品主线）**：按 todo-archive-mvp 落地归档 MVP——补齐归档链端点、新增 `ArchiveService` 断点续传流、全链路结构快照。

**P1（契约硬化）**：C3 消掉 `as any`、E3 补全变种测试、E5 落地 schema 回归、F2 收窄生熟双 API。

**P2（DX/流程减负）**：E4 telemetry 消费端示例、F3 CLI 裁剪、E6 流程回流简化。

---

## 参考

- 行动计划：[todo-archive-mvp.md](../planning/todo-archive-mvp.md)
- 候选任务：[backlog.md](../planning/backlog.md)
- 架构决策：[architecture.md](../planning/architecture.md)
- 需求规格：[requirements-spec.md](../requirements/requirements-spec.md)
