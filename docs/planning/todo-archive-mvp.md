# 行动计划：个人数据归档 MVP（todo-archive-mvp）

**产品定位**（2026-08-09 决策）：`weibo-sdk` = 可靠地把一个微博账号的公开数据**镜像下来**——可断点续传、可观测、默认离线可测。

> 来源：[review-apple-design-2026-08-09.md](../reviews/review-apple-design-2026-08-09.md)（F/C/E/D 问题编号）。本计划承接产品主线，候选任务见 [backlog.md](./backlog.md)。

**优先级**: 🔴 P0（立即）→ 🟡 P1（产品主线 / 契约硬化）→ 🟢 P2（DX / 流程减负）

---

## P0 · 契约一致性收口（1 天）

> 承接 review C1 / C2。这些是「连版本号都不能自洽」「公开类型背离真实」的硬伤，合并门禁前的止血项。

- [x] **P0-1 版本单一来源**（C1）：`package.json` 为唯一版本源，`src/index.ts` / `src/cli.ts` 从之读取，消除三处不一致。→ `b0c46ac`
- [x] **P0-2 `sinceId` 对齐真实类型**（C2）：`TweetPageResult.sinceId` 由 `number` 改为 `string`（真实 API 返回 string，空串 = 无更多）；补「空串 / 超大 ID」分页测试（Red → Green），另补 `listFriendTimeline` 对偶测试（`-1` → 空串；number → string 游标回传）。
- [ ] **P0-3 合并/关闭 `claude/cli-gap-fill`**：本地 worktree 已清理（`git worktree list` 仅主 tree）；远程分支 `origin/claude/cli-gap-fill` 待删除（双点 diff 确认无 main 缺少内容，见开发日志）。

---

## P1 · 产品主线：归档 MVP（2–3 周）

> 目标：把「镜像一个微博账号」做成**一个入口、一件事**，而不是 15 个零散端点。

### 归档链端点补齐

- [x] **A1 转发列表** `/ajax/statuses/repostTimeline`：真实 fixture（`repost_timeline.json`/`_p2`）→ `repostTimelineSpec` → `TweetService.getReposts` → CLI `tweet reposts` → 测试。
- [x] **A2 粉丝列表**（`friendships/friends` 对偶）：复用 `friendshipsSpec` 加 `relate` 参数 → `FollowingsService.getFans` → CLI `follow fans` → 测试。
- [x] **A3 收藏夹标签** `/ajax/favorites/tags`：`favoritesTagsSpec` → `FavoriteService.getTags` → CLI `favorite tags` → 测试。
- [ ] **A4 按日期搜索缺的变体参数**：`searchProfile` 的 `hasret/hasvideo/hasmusic` 等过滤组合补 E2E 验证。

### ArchiveService：断点续传流（核心交付）

- [ ] **A5 定义 `ArchiveService`**：一个入口把 `mymblog` + `searchProfile` + `repost` + `favorites` 串成一条可恢复的 AsyncIterator 流。
- [ ] **A6 断点续传**：流式游标序列化（进度 checkpoint），中断后从断点续跑；配合 RateLimitService 防风控。
- [ ] **A7 全链路结构快照**（复用 ADR-011 `stripVolatileKeys`）：归档链路每个环节作为上游漂移检测器。
- [ ] **A8 CLI 归档子命令**：`weibo-sdk archive <uid>` 一个命令触发整条归档，JSON 进度输出。

> 判别标准：一个只装了本 SDK 的开发者，用 ≤20 行代码 + 一条 CLI 命令，就能把某个账号的公开内容完整镜像到本地。

---

## P1 · 契约硬化（与产品主线并行）

> 承接 review C3 / E3 / E5 / F2。

- [ ] **C3 消掉 `args as any`**：`comments()` / `searchByDate()` / `friendTimeline()` 改为走 argsSchema 类型推导，补「args 类型」回归测试防复发。
- [ ] **E3 补全变种测试**：含视频（`mix_media_info`）/ 含位置（`geo`）/ 含 `continue_tag`（长图文）/ 广告（`isAd`）四类，覆盖 `extractMediaFromMixMediaInfo` 最复杂路径。
- [ ] **E5 落地 schema 自动回归**：`scripts/validate-fixtures.ts` 遍历 `tests/fixtures/raw/*.json` × 对应 schema 做 safeParse，纳入 CI，作为「离线契约回归」。
- [ ] **F2 收窄生熟双 API**：raw 方法标 `@deprecated`（`show`/`myMblog`/`friendTimeline` 等），normalized 为默认；规格书 §3.3 同步标注逃生舱语义。

---

## P2 · DX 与流程减负

> 承接 review E4 / E6 / F3。

- [ ] **E4 telemetry 消费端示例**：提供一个 JSONL exporter 示例（事件落盘 / 结构化日志接入），让 Wide Events 有消费端。
- [ ] **F3 CLI 裁剪评估**：保留 hero workflow（`archive` / `whoami` / `trends`）相关命令，评估移除对称镜像命令；CLI Mandate 措辞同步调整。
- [ ] **E6 流程回流简化**：审查 CLAUDE.md 强制规范，砍掉「只为仓库服务」的流程，保留「为用户服务」的（读 postmortem 高频雷区、合并门禁、文档即事实）。
- [ ] **DX：TSDOC 全覆盖**（TODO 遗留）：公共 API 全部补 TSDoc（参数边界 / 异常 / Wide Event 触发点）。
- [ ] **DX：归档快速开始示例**：README 的快速开始改为演示归档主线（而非 3 个孤立单调用）。

---

## 完成定义（DoD）

- [ ] `pnpm test` 通过（默认离线，e2e 全跳）
- [ ] `pnpm run typecheck` 通过
- [ ] 新增功能有对应测试（Red → Green → Refactor）
- [ ] 文档与代码一致（docs-as-truth）
- [ ] 归档主线可演示：≤20 行代码 + 1 条 CLI 命令完成单账号镜像
- [ ] 开发日志记录本阶段；关键返工沉淀 postmortem

> 阶段完成后本档移入 `docs/archive/`，未完成项回流 [backlog.md](./backlog.md)。
