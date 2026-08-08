# 任务清单（Backlog）

**用途**: 收拢各已完成阶段「本版不做」的任务，作为后续阶段候选。新阶段从本清单挑选，承接后在此标注状态，完成后移入「已完成/已承接」。

**状态图例**: 🟢 可承接 → ⏸️ 暂缓（随时可承接）→ ❌ 已移除（产品决策，不再做）

> 来源编号引用 [review-apple-design-2026-08-09.md](../reviews/review-apple-design-2026-08-09.md)（F/C/E/D）与 [todo-archive-mvp.md](./todo-archive-mvp.md)（A/C/E/F）。

## 当前方向

**个人数据归档 MVP**（2026-08-09，产品决策）——[todo-archive-mvp.md](./todo-archive-mvp.md) 承接产品主线（A1-A8 + 契约硬化 C/E/F）与 P2 减负（E4/F3/E6）。本清单收拢**下下阶段**候选。

---

## 候选任务

### 契约与设计债（暂缓）

| # | 任务 | 状态 | 优先级 | 说明 | 来源 |
|---|---|---|---|---|---|
| C5 | 错误分类统一（level 与类名解耦） | ⏸️ | P2 | `level` 由实例声明而非类继承决定，两套真相；选一个明显且唯一的系统 | review C5 |
| E1 | 框架层瘦身评估 | ⏸️ | P2 | EndpointSpec/IResource 是否过度泛化：先承接 P1 契约硬化（消 `as any`、schema 回归）后，用真实使用量评估抽象是否成立 | review E1 |
| E2 | `filterTweets` 的 `any` 清理 | ⏸️ | P2 | strict 模式漏网（`TweetService.ts:37`），改为 `unknown` + 收窄 | review E2 |
| — | 领域模型继续精确化 | ⏸️ | P2 | 更多变种字段（`annotations` 异构、`page_info` 类型漂移）的 fallback 链补充，随真实 fixture 驱动 | 渐进式开发计划 Phase 2 |

### 端点扩展（暂缓，非归档优先）

| # | 任务 | 状态 | 优先级 | 说明 | 来源 |
|---|---|---|---|---|---|
| — | 评论回复树 | ⏸️ | P3 | `buildComments` 的对偶（评论的回复/楼中楼），依赖评论字段精确化 | 渐进式开发计划 Phase 5 后续 |
| — | 搜索能力增强 | ⏸️ | P3 | `searchTweets` 高级筛选参数（时间范围/媒体类型过滤） | 渐进式开发计划 Phase 5 后续 |
| — | 私信/消息能力 | ❌ | — | 超出「公开数据归档」范围且敏感，**产品决策不做** | todo-archive-mvp 定位 |

### DX 与可观测性（暂缓）

| # | 任务 | 状态 | 优先级 | 说明 | 来源 |
|---|---|---|---|---|---|
| — | Isomorphic 环境验证 | ⏸️ | P3 | 浏览器/Node/Edge 双环境兼容验证（`axios` 依赖能否替换为原生 `fetch` 的无依赖形态） | SKILL.md 第五条 |
| — | 集成测试补位 | ⏸️ | P2 | 更多端点的 E2E 结构快照覆盖（当前只有核心 4 端点）；CI 无覆盖率门禁 | 渐进式开发计划 测试策略 |
| — | 错误诊断增强 | ⏸️ | P3 | `error-diagnostics.md` 补决策树（不同 code 的排查路径 + curl 复现） | review 延伸 |

---

## 已移除（产品决策）

| 任务 | 原因 | 日期 |
|---|---|---|
| 私信/消息能力 | 超出「公开数据归档」范围，且涉及他人隐私数据 | 2026-08-09 |

## 已完成/已承接

| 任务 | 状态 | 承接 |
|---|---|---|
| P0 契约一致性（版本单一来源 / `sinceId` 对齐 / 合并 cli-gap-fill） | ⏸️ 待承接 | [todo-archive-mvp.md](./todo-archive-mvp.md) P0 |
| 归档链端点（repostTimeline / 粉丝列表 / favorites-tags） | ⏸️ 待承接 | [todo-archive-mvp.md](./todo-archive-mvp.md) A1-A3 |
| ArchiveService 断点续传流 + 全链路快照 + CLI 归档 | ⏸️ 待承接 | [todo-archive-mvp.md](./todo-archive-mvp.md) A5-A8 |
| 契约硬化（消 `as any` / 变种测试 / schema 回归 / 收窄双 API） | ⏸️ 待承接 | [todo-archive-mvp.md](./todo-archive-mvp.md) P1 |
| telemetry 消费端 / CLI 裁剪 / 流程简化 / TSDOC / 快速开始示例 | ⏸️ 待承接 | [todo-archive-mvp.md](./todo-archive-mvp.md) P2 |

> 各阶段交付细节见 [development-log/](../development-log/README.md)；完成后移入 [archive/](../archive/README.md)（存档不主动读取）。
