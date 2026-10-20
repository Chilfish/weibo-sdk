# 任务清单（Backlog）

**用途**: 收拢各已完成阶段「本版不做」的任务，作为后续阶段候选。新阶段从本清单挑选，承接后在此标注状态，完成后移入「已完成/已承接」。

**状态图例**: 🟢 可承接 → ⏸️ 暂缓（随时可承接）→ ❌ 已移除（产品决策，不再做）

> 来源编号引用 [review-apple-design-2026-08-09.md](../reviews/review-apple-design-2026-08-09.md)（F/C/E/D）与 [todo-archive-mvp.md](../archive/todo-archive-mvp.md)（A/C/E/F）、[review-apple-design-2026-08-10.md](../reviews/review-apple-design-2026-08-10.md)（K/R）。

## 当前方向

**0.1.0 + 0.2.0 已完成并归档（2026-10-20）**——上一阶段行动计划 [todo-post-0.1.0.md](../archive/todo-post-0.1.0.md) 已完成：发布收口、用户数据面、归档媒体 / 增量 / 批量、契约字段、可靠性与 DX 全部收口。**当前没有进行中的阶段计划**；下一阶段从下方「候选任务」挑选，承接后新建 `docs/planning/todo-<stage>.md`。发布细节见 [release-checklist.md](../engineering/release-checklist.md)；同类项目调研见 [research-weibo-ecosystem-2026-10-19.md](./research-weibo-ecosystem-2026-10-19.md)。

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
| — | **公开关键词搜索恢复** | ⏸️ **产品暂缓** | — | **2026-10-19 产品裁定**：官方微博搜索体验差、逆向收益低，公开关键词搜索先放放。注意与「个人主页内搜索自己的微博」区分——`searchProfile`（`searchByDate`）仍可用且属于归档主线。现状：`searchUsers`/`searchTweets` 抛 `UnexpectedAPIResponseError`（`API_BAD_RESPONSE`），保留 `@deprecated` 候选；若未来恢复，再评估 SSR HTML / 独立登录态方案 | 2026-10-19 维护者裁定 + 2026-08/10 验证 |
| — | 私信/消息能力 | ❌ | — | 超出「公开数据归档」范围且敏感，**产品决策不做** | todo-archive-mvp 定位 |

### DX 与可观测性（暂缓）

| # | 任务 | 状态 | 优先级 | 说明 | 来源 |
|---|---|---|---|---|---|
| — | Isomorphic 环境验证 | ⏸️ | P3 | 浏览器/Node/Edge 双环境兼容验证（`axios` 依赖能否替换为原生 `fetch` 的无依赖形态） | SKILL.md 第五条 |
| — | 集成测试补位 | ⏸️ | P2 | E2E 已覆盖核心端点（2026-10-19：18 用例全绿）；仍缺更多变体与失败路径；CI 无覆盖率门禁 | 渐进式开发计划 测试策略 |
| — | 错误诊断增强 | ⏸️ | P3 | `error-diagnostics.md` 补决策树（不同 code 的排查路径 + curl 复现） | review 延伸 |
| — | Agent 可发现性（SKILL.md / AGENTS.md） | ✅ | P3 | 已落地 `.agents/skills/weibo-sdk/SKILL.md`（skill-creator 模板）与 `AGENTS.md` 使用速查；`llms.txt` 不适用（不暴露 HTTP 服务） | 2026-10-19 调研 |

---

## 已移除（产品决策）

| 任务 | 原因 | 日期 |
|---|---|---|
| 私信/消息能力 | 超出「公开数据归档」范围，且涉及他人隐私数据 | 2026-08-09 |
| D6 音频播放列表端点 | 单条 `ITweet.audio` 已支持；播放列表接口缺真实样本，维护者裁定不再推进 | 2026-10-20 |
| D15 转发历史独立端点 | 候选路径已失效；继续用 `mymblog` + 转发过滤即可 | 2026-10-20 |
| 无 Cookie 访客模式 / 定时 E2E canary / `--detail compact\|full` / CI 端点 checklist / MCP server / 导出适配器 / 多账号登录态隔离 / 二维码登录 / Docker 示例 | 0.2 阶段收尾时维护者裁定不再推进 | 2026-10-20 |

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
| 归档扩展（媒体 / 增量 / 批量 / 仅原创 / 状态文件） | ✅ 已完成 | `streamArchive` / `streamUsersArchive` / `archiveState`（2026-10-20） |

> 各阶段交付细节见 [development-log/](../development-log/README.md)；完成后移入 [archive/](../archive/README.md)（存档不主动读取）。
