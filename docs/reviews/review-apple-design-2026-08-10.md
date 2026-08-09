# weibo-sdk 设计审查 — Apple 产品与研发视角（第二轮）

**审查日期**: 2026-08-10
**审查范围**: 全仓库（源码 + 文档 + 测试）+ 下游集成文档（`I:\dev\Weibo-archiver`）
**审查方式**: AI 外部审查（Apple 产品哲学 + 研发纪律双视角）
**分支**: main @ `4bad0be`
**决策背景**: weibo-sdk 将**发布为 npm 包**；有**真实下游消费者** `Weibo-archiver`（web-v3 浏览器 SPA 直接消费 SDK 抓取、monkey/CLI 跑 SDK 归档），且下游 ADR-007/008 把 `ITweet` 定为 **UI 展示终局契约 + 磁盘存档终局契约**（存进 IndexedDB）

> 本档是第二轮「锐评」的正式沉淀。第一轮（2026-08-09，[review-apple-design-2026-08-09.md](./review-apple-design-2026-08-09.md)）确立了「个人数据归档」定位并推动了 MVP（A1-A8）；本轮基于**npm 发布 + 真实下游**两个新事实重评。
> 引用编号：本档问题用 K / R 两组；沿用第一轮 C / E / F 编号的升级项单独列出。
> 行动计划见 [todo-contract-freeze.md](../planning/todo-contract-freeze.md)。

---

## 〇、总评

第一轮的批评「15 端点能力齐全、无主线」已被产品决策和 MVP 交付部分化解。但下游引入了一个第一轮**完全没考虑过**的维度：

> **`ITweet` 从「响应形状」变成了「磁盘格式」。** 下游把它存进 IndexedDB、长期持有、用于展示与迁移。改一个字段 = 破坏用户已归档的数据。ABI 稳定性不再是口号，是格式问题。

这把问题的性质从「框架质量」推高到「平台责任」。当前最要命的不是缺端点，而是三件事：

1. **契约没有版本**（K1）：改 `ITweet` 字段即破坏下游存档，且无迁移机制。
2. **归档主线在规模下不成立**（R1-R5 / K4）：大号翻不到底、内存 O(N²)、无进度、无容错、缺评论。
3. **媒体契约悬空**（K3）：URL 一小时过期，却被当长期存档持有。

### 分维度评分

| 维度 | 评分 | 一句话 |
|---|---|---|
| 研发纪律（测试/文档/postmortem） | ⭐⭐⭐⭐⭐ | 不变，数据驱动 + 分层测试仍是个人项目天花板 |
| 数据驱动正确性 | ⭐⭐⭐⭐⭐ | 不变 |
| 产品聚焦 | ⭐⭐⭐⭐ | 主线已定并交付，但「完整镜像」对大号不真、缺评论（R5/K4） |
| 契约一致性 | ⭐⭐⭐ | C1/C2 已修、版本单一来源；但契约自身无版本/无 `@deprecated` 机制（K1） |
| **下游契约稳定性** | ⭐⭐ | **新增维度**。ITweet=存档格式但无版本管理；版本策略与协议漂移耦合（K1/K2） |
| 抽象超前性 | ⭐⭐⭐ | 框架写给 100 端点、现状 16；`as any` 未清（C3/E2） |
| 工程流程 | ⭐⭐⭐ | 仪式仍偏重；发布后部分仪式变得正当（E6 需重新平衡） |
| 可观测性落地 | ⭐⭐⭐ | 协议干净；下游长任务进度正好是消费端，价值上升（E4） |

---

## 一、值得保留的（Apple 也会这么做）

第一轮五条（数据驱动 / EndpointSpec 单一路径 / 测试分层 + 结构快照 / 结构化错误 + Wide Events / 离线测试默认可跑）**全部保留**，本轮新增三条确认：

| 决策 | 为什么像 Apple |
|---|---|
| 下游 CORS 通道选型（monkey 域内跑 sdk + CLI 兜底，web 保持纯展示） | 「One way to do it」——没有硬碰 CORS，选择架构上最干净的通道（ADR-005 不变） |
| core 冻结防双轨维护（集成文档 M2） | 职责单一归属：抓取/归一化只归 sdk，core 退化为存档数据层 |
| 迁移纪律（备份 + dexie version + dry-run + 抽样 + 回退） | 动用户数据前先想好回退，Apple 的「不可逆操作必须可回退」 |

---

## 二、问题清单（按严重度）

### 🔴 K — 下游契约（本轮最大盲区）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| K1 | **ITweet 是磁盘格式，但无版本管理** | `src/types/domain/ITweet.ts`、下游 ADR-008 | 下游把 ITweet 存进 dexie 当存档。SDK 无 `schemaVersion`、无迁移机制；`schemaDigest`（`src/utils/structure.ts`）只检测「上游漂移」，不管理「契约版本」——用途完全不同。改字段 = 毁档。发布前必须冻结 v1 + 定义版本迁移策略 |
| K2 | **版本策略与协议漂移耦合** | 集成文档 §3.1 | 「主版本跟随协议破坏性变更（微博接口漂移即 breaking）」——微博每漂移一次，下游被迫 major 升级一次，哪怕存档契约没变。必须解耦：**契约版本**（驱动下游 breaking）≠ **包版本**（实现修复/新端点） |
| K3 | **媒体 URL 一小时过期，却被当长期存档** | `ITweet.ts:82-85` | SDK 自己写着视频/实况 URL「有效期为请求时间+1小时」，下游却把 `media[].imageUrl/videoUrl` 当存档持有。跨项目契约缺口，publish 前必须裁定（SDK 归档时下载，或明示 URL 临时、消费方自抓） |
| K4 | **「完整镜像」缺评论** | `ArchiveService.ts`（三阶段无 comments） | 下游 web-v2 的 core `Post` 已存 `comments[]`，迁移到 ITweet 时无家可归（集成文档 §5.1）。归档流 timeline→reposts→favorites 根本没有评论阶段。用户存档没有评论 = 不完整镜像 |
| K5 | **normalizeTweet 有损归一化** | `src/models/data/Tweet.ts` | `.passthrough()` 在 schema 层保留 open 字段，但 `normalizeTweet` 只构建固定 ITweet 形状、其余丢弃。作为存档契约，导致迁移有损（`card`/`comments`/`isShowBulletIn` 只能丢弃或重拉，集成文档 §5.1） |
| K6 | **无 browser 构建，Isomorphic 未验证** | `tsdown.config.ts: platform:'node'`、`FetcherService.ts:91` proxy | 下游 web-v3/monkey 在浏览器/油猴域内跑 sdk。主库表面无 node API（cli 的 `node:fs` 在独立入口），但 `platform:'node'` + axios `proxy`（Node-only，浏览器静默失效）未验证。发布前需 browser 冒烟或加 browser target |

### 🔴 R — ArchiveService 硬化（hero 的工程细节）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| R1 | **`visitedMblogIds` 死重且 O(N²) 爆炸** | `ArchiveService.ts:106,141,171`、`cli.ts:109,117` | 数组只增不减、每个 item 共享引用，但**没有任何代码消费它去重**（测试只断言其存在）；CLI 每 item 打印完整 checkpoint、出错落整份。1 万条 = 每 item 序列化 1 万长度数组。要么真用于去重（同页重复即到底），要么删 |
| R2 | **reposts 阶段重放整个 timeline** | `ArchiveService.ts:126,193`（`collectTimelineMblogIds`） | 每次跑 / 每次续传都把最贵的 timeline 翻两遍（测试证实 `myMblog` 被调 4 次，`ArchiveService.test.ts:79`），`guard < 1000` 静默截断。timeline id 应入 checkpoint 或内联拉取 |
| R3 | **无进度、无 ETA** | `ArchiveService.ts` | 需求写「进度可追踪」，但流无 total/已处理/剩余。CLI 只能逐行 item，回答不了「13581 条还剩多少」。长任务没有进度 = 没做完 |
| R4 | **单点失败即全盘崩溃** | `ArchiveService.ts` | 某条微博的转发挂了，整个 `for await` 中止。长归档无 skip/retry。错误体系有 `retryable`，ArchiveService 没用 |
| R5 | **page 翻页有天花板 → 完整镜像对大号不真** | `ArchiveService.ts`、提交 `4bad0be` | mymblog 已弃用 since_id 改 page（2026-08 实测），而 page 有上限；dev-log 实测样例账号 **13581 条微博**。靠 page 永远拉不完。`searchProfile` 时间片是「完整镜像」的必要组件，现在躺在 backlog 当增强项 |

### 🟠 沿用第一轮（升级 / 未决）

| # | 状态 | 说明 |
|---|---|---|
| C3（`args as any`）/ E2（`filterTweets any`） | 🔺 升级 | npm 发布后是「对外 `.d.ts` 说谎」。发布前清 |
| E5（`validate-fixtures.ts` 入 CI） | 🔺 升级 | 上游漂移回归，发布后是下游数据质量护城河 |
| F2（生熟双 API 收窄） | 🔺 升级 | 下游只用 normalized；raw 应 `@deprecated` |
| E4（telemetry 无消费端） | 🔺 升级 | 下游长任务进度 UI 正好是消费端 |
| F3（CLI 裁剪） | 🟢 降级 | 下游 `apps/cli` + monkey 可能换源 sdk（集成文档开放问题 4），CLI 有真实 persona 了；裁可以但动机从「流程产物」变成「有消费者」 |
| E6（仪式感） | ➖ 重新平衡 | 发布 + 消费后，semver / changelog / `@deprecated` 等仪式**正当**；docs-first per-commit 等内部仪式仍可减 |
| C1 / C2（版本单一来源 / sinceId 对齐真实 string） | ✅ 已修复 | 第一轮 P0 已落地（`9da590c`） |

---

## 三、根因分析（blameless）

视角再次倾斜，且比第一轮更值得警惕：

1. **「正确性」仍被定义成「schema 与 raw 一致」，不是「下游能安全持有这份数据」**。数据驱动把「端点正确」做到极致，但没回答「这份 ITweet 被存进数据库一年后还能不能读」。K1/K3/K5 都是「响应正确」压倒「契约安全」的产物。
2. **契约稳定停留在文档层，未进入类型层与格式层**。C1/C2 修了版本与 sinceId，但「契约本身要版本化」「URL 是临时的」没变成类型/字段的硬约束。K3 甚至写在注释里——**意识到但没当契约处理**。
3. **hero feature 的工程细节被当「功能」而非「产品」做**。ArchiveService 交付了「能跑」，但 R1-R5 的规模问题说明它没被当「用户要长期跑、要跑完、要能续、要能看进度」的产品做。Apple 会反问：你承诺的那一件事，真的做到极致了吗？

---

## 四、与 Apple 产品哲学的差距表（更新）

| 维度 | Apple 参考 | weibo-sdk（现状） |
|---|---|---|
| 数据契约 | 存档格式有 schema 版本与迁移路径（NSKeyedArchiver 版本化） | ITweet 无版本、无迁移（K1） |
| 平台责任 | 提供方对持久化格式负责 | 有损归一化 + 过期 URL 进存档（K3/K5） |
| hero 完整性 | 一件事做到极致 | 大号翻不到底、缺评论、无进度（R3/R4/R5/K4） |
| 版本策略 | 契约版本与实现版本解耦 | 主版本跟随协议漂移（K2） |
| 运行时 | 验证过的目标环境 | `platform:node` 未验证浏览器（K6） |
| 默认路径 | 一个明显的方式 | raw/normalized 双 API 未收窄（F2） |
| 工具 | 为特定 persona 造工具 | CLI 已有 persona（monkey/cli），F3 降级 |

---

## 五、行动优先级（依据）

> 行动项已落到 [todo-contract-freeze.md](../planning/todo-contract-freeze.md)，此处只给方向。

**P0（发布阻塞）**：K1 契约版本化、K2 版本策略解耦、K3 媒体契约裁定（**跨项目，先开会**）、契约卫生（C3/E2/E5/F2）、版本声明（0.x 冻结 or 1.0）。

**P1（归档硬化）**：R1-R5 + K4 评论归档 + E3 变种测试补全——让「完整镜像」在规模下成立。

**P2（下游集成就绪）**：K6 browser 构建 + 冒烟、K5 有损迁移评估、E4 telemetry 消费端、F3 CLI 复审、E6 流程回流。

---

## 参考

- 第一轮审查：[review-apple-design-2026-08-09.md](./review-apple-design-2026-08-09.md)
- 行动计划：[todo-contract-freeze.md](../planning/todo-contract-freeze.md)
- 下游集成方案：`I:\dev\Weibo-archiver\docs\planning\weibo-sdk-integration.md`
- 下游迁移方案：`I:\dev\Weibo-archiver\docs\planning\web-v3-migration.md`
- 需求规格：[requirements-spec.md](../requirements/requirements-spec.md)
- 架构决策：[architecture.md](../planning/architecture.md)
