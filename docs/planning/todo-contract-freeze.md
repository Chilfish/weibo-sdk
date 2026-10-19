# 行动计划：契约冻结与归档硬化（发布就绪）

> 承接 [todo-archive-mvp.md](../archive/todo-archive-mvp.md)（A1-A8 + P0 已完成，已移入 `docs/archive/`）。
> **前提事实**：weibo-sdk 发布为 npm 包，被 Weibo-archiver 的 web-v3（浏览器 SPA）/ monkey / CLI 消费；`ITweet` 被定为下游 **UI 与存档终局契约**（ADR-007/008，存进 IndexedDB）。
> 本阶段主题：**让 ITweet 成为可靠的磁盘格式 + 让归档主线在规模下成立**。
> 来源：[review-apple-design-2026-08-10.md](../reviews/review-apple-design-2026-08-10.md)（K/R 编号）。候选任务见 [backlog.md](./backlog.md)。

**优先级**: 🔴 P0（发布阻塞）→ 🟡 P1（归档硬化）→ 🟢 P2（下游集成就绪）

---

## P0 · 契约冻结与发布阻塞（缺一不可发布）

> 对应 review K1 / K2 / K3 与契约卫生（C3/E2/E5/F2）。

- [x] **P0-1 冻结 ITweet 为 v1 存档契约**（K1）：`TWEET_CONTRACT_VERSION = 1`；`ArchiveItem` 信封携带 `schemaVersion`；契约规则/冻结表/迁移策略见 [contract-itweet-v1.md](../engineering/contract-itweet-v1.md)，形状锁在 `tests/unit/contract/itweet-v1.test.ts`。（2026-09-04，`10c1e3e`）
- [x] **P0-2 裁定媒体契约**（K3）：选「URL 临时、消费方自抓」；`ArchiveItem` 定形 `{ schemaVersion, source, mblogId, tweet, schemaDigest, checkpoint }`（无 `mediaFiles`）；媒体下载辅助留 P1-7。裁定与理由见 [contract-itweet-v1.md §4](../engineering/contract-itweet-v1.md)。（2026-09-04）
- [x] **P0-3 版本策略解耦**（K2）：契约版本 ≠ 包版本；协议漂移走内部 schema 修复 + patch/minor，契约破坏性变更才 major。已写入 [release-checklist.md](../engineering/release-checklist.md)「版本纪律」。（2026-09-04/2026-10-19）
- [x] **P0-4 契约卫生**：C3 消 `args as any`；E2 `filterTweets` `any` → `unknown` + `isRawTweet` 收窄；F2 raw 方法标 `@deprecated`。见 `dc18389`。（2026-09-04）
- [x] **P0-5 离线契约回归落地**（E5）：`scripts/validate-fixtures.ts` 遍历 fixtures × schema 做 safeParse，接入 CI 与单测；落地时抓到 `specialAttention` 真实漂移并修复（`0671638`、`7a8bfd4`）。（2026-09-04）
- [x] **P0-6 版本声明**：0.x 明确「实现可随上游漂移修复，ITweet 存档契约自 v1 冻结、只增不改」；README/CHANGELOG 与 archiver 锁版本策略对齐。（2026-09-04 裁定，2026-10-19 文档回填）

> **2026-10-19 状态**：P0 六项全部收口；真实 E2E 18/18（Cookie 只读 `.env`，结构快照改为纯类型占位）。剩余 DoD（万条级验证 / 媒体职责跨项目确认 / browser 冒烟）转入 P1/P2 跟踪；调研结论见 [research-weibo-ecosystem-2026-10-19.md](./research-weibo-ecosystem-2026-10-19.md)。

## P1 · 归档硬化（产品主线）

> 对应 review R1-R5 / K4 / E3。

- [ ] **P1-1 `visitedMblogIds` 去重或删除**（R1）：同页重复 → 到底 break（幂等保护）；checkpoint 不再逐 item 携带全量数组（改增量/游标），消除 O(N²) 序列化。
- [ ] **P1-2 reposts 去重放**（R2）：timeline id 写入 checkpoint 或 timeline 阶段内联拉转发，去掉 `collectTimelineMblogIds` 全量重放。
- [ ] **P1-3 进度事件**（R3）：`archive_progress` Wide Event（total / 已处理 / 剩余）+ CLI 进度输出（NDJSON 带 count/total）。
- [ ] **P1-4 单条失败策略**（R4）：skip/retry（复用 `retryable` 结构化错误），单条转发失败不中止整条归档。
- [ ] **P1-5 searchProfile 时间片补齐**（R5）：page 翻到底自动切日期切片，大号（万条级）完整镜像成立。
- [ ] **P1-6 评论归档**（K4）：ArchiveService 加 comments 阶段，「完整镜像」不缺评论。
- [ ] **P1-7 媒体下载进归档流**（若 P0-2 裁定 SDK 负责）。
- [ ] **P1-8 E3 变种测试补全**：含视频（`mix_media_info`）/ 含位置（`geo`）/ 含 `continue_tag`（长图文）/ 广告（`isAd`）四类，覆盖 `extractMedia` 最复杂路径。
- [x] **P1-9 raw / enrich 访问 API**（K5 衍生，2026-10-19 裁定）：`ArchiveItem` 不携带 raw；新增请求级 `hooks.onRaw(raw, meta)`（Zod 校验前触发）、归档级 `streamArchive(uid, { onRaw })`（逐原始项）、`tweets.enrich(mblogId, { includeLongText? }) → { tweet, raw, longText? }`，下游自行落盘 raw。规则见 [contract-itweet-v1.md §4.1](../engineering/contract-itweet-v1.md)。（2026-10-19）

## P2 · 下游集成就绪

> 对应 review K6 / K5 / E4 / F3 / E6。

- [ ] **P2-1 browser 构建 + 冒烟**（K6）：tsdown 加 browser target，或验证 node 产物浏览器可用（`proxy` Node-only 处理）；web-v3 / monkey 冒烟。
- [ ] **P2-2 有损迁移评估**（K5）：与 archiver 明确 `comments` / `card` 取舍；评估 ITweet 是否需保留原始字段或扩展字段。
- [ ] **P2-3 telemetry 消费端**（E4）：JSONL exporter 示例，供 web-v3 长任务进度/事件消费。
- [ ] **P2-4 CLI 裁剪复审**（F3）：有消费者（monkey/cli），保留 hero 命令（`archive` / `whoami` / `trends`），评估对称镜像命令。
- [ ] **P2-5 流程回流**（E6）：保留发布/契约仪式（semver / changelog / @deprecated），砍内部仪式（docs-first per-commit 等）。
- [ ] **P2-6 TSDOC 公共 API 全覆盖**：npm 包 DX 底线。

---

## 完成定义（DoD）

- [x] `pnpm test` 通过（默认离线，e2e 全跳）；`pnpm run typecheck` 通过（2026-10-19：135 passed / 18 skipped）
- [x] ITweet 契约冻结为 v1（含版本机制或冻结文档）
- [ ] ArchiveService 大号验证：万条级账号可完整镜像、无 O(N²) 序列化、可断点续传、有进度
- [x] 媒体契约裁定（URL 临时、消费方自抓；与 archiver 的最终同步仍待其仓库可读）
- [ ] browser 冒烟通过（web-v3 / monkey 可消费）
- [x] 文档与代码一致（docs-as-truth；2026-10-19 已回填 P0 状态与调研）
- [x] 开发日志记录本阶段；关键返工沉淀 postmortem（[009-cookie-env-shadowing](../postmortem/009-cookie-env-shadowing.md)）

> 阶段完成后本档移入 `docs/archive/`，未完成项回流 [backlog.md](./backlog.md)。
