# 行动计划：下游交接（API 稳定子集 + 公开文档站）

> **状态**：进行中（2026-10-22 启动）。目标版本 `0.6.0`（0.5.0 已发布）。
> **来源**：0.5.0 发布时的文档评估（[development-log/2026-10-22.md](../development-log/2026-10-22.md)）与公开面审计。
> **目标**：把 SDK 交给下游前，收口公开面并建立可强制校验的公开文档；公开文档站与内部 `docs/` 物理分离。

## 已拍板决策

| 决策 | 结论 |
|---|---|
| 稳定策略 | 0.x + 明确 Stable / Experimental / Internal 子集；不立即发 1.0 |
| 稳定性承诺 | Stable 子集破坏性变更 → 包 major；0.x 内至少 CHANGELOG 迁移说明 |
| API 参考 | 手写服务级参考 + CI 覆盖率校验；不引入 TypeDoc |
| 语言 | 中文为主，API 名与字段保留英文 |
| 文档站位置 | 新目录 `website/`；`docs/` 只留内部文档 |
| 下游文档归属 | `docs/engineering/` 中偏下游的 8 篇迁入 `website/`，不保留副本 |
| 部署 | Vercel（Git 集成，docs/website 变更自动部署）+ 自定义域名 `weibo-sdk.chilfish.top` |

## 公开面分层

见 [api-stability.md](../engineering/api-stability.md)。

- **Stable**：门面与配置、返回领域模型的读取/流方法、领域模型、归档契约、扩展端口、错误体系。
- **Experimental**：返回原始上游形状的方法、42 个 `z.infer` 响应类型、辅助函数。
- **Internal**：endpoint `*Args`、`*Deps`、`IResource`、分页/日志/遥测内部工具、`Tweet`/`User` 类等，从包根移除。

## P0 公开面收口

1. 返回类型统一：`getById` → `IUser`；`getByMblogId` / `enrich().tweet` / 所有 `stream*` → `ITweet`；`ArchiveItem.tweet` → `ITweet`。
2. 命名：9 个匿名参数类型具名化；`comments` / `replies` 选项字段改 camelCase；补导出 `TweetPageResult`、`TweetFriendTimelineStreamProgress`、`FollowingUser`。
3. 收窄包根导出，删除 Internal 符号；`src/index.ts` 改显式具名导出。
4. 修正 `capabilities()`：guest 可用的 `auth` 改 `guest`；修正 `methods` 名称；补 `tweets.replies`、`tweets.longText`、门面自身；新增「方法必须可调用」测试。
5. 新增 `api-surface.json`、`scripts/check-api-surface.ts`：导出面快照 + 分类完整性 + 文档覆盖率；`pnpm check:api`。
6. `schemas/` 随包发布，`ARCHIVE_SCHEMA_URL` 指向文档站；`schema:check` 进 CI（关闭 package-integrity R10）。

## P1 公开文档站

- 站点目录 `website/`：`guide/`（12 篇）、`api/`（19 篇）、`api/types/`（6 篇）、`cli/`、`reference/`、`index.md`、`contributing.md`。
- 迁移：`cli.md`（拆分架构部分）、`contract-itweet-v2.md`、`archive-schema.md`、`user-archive.md`、`media-download.md`、`plugins.md`、`logging.md`、`error-diagnostics.md`。
- 公开化清理：禁止 `I:\dev\`、`docs/engineering`、规划/postmortem 链接；新增 `scripts/check-public-docs.ts`。
- VitePress：`lang: zh-CN`、`base: '/'`、local search、sitemap、`docs:*` 脚本。
- 部署：仓库根 `vercel.json`（`buildCommand: pnpm docs:build`、`outputDirectory: website/.vitepress/dist`），Vercel 项目 Root Directory 设为仓库根；Git 集成在 docs/website 变更时自动部署。

## P2 部署与流程

- Vercel Git 集成：与 `main` 关联，`website/**`、`schemas/**`、`pnpm-lock.yaml` 等变更自动重新构建；PR 生成 Preview。
- `ci.yml`：增加 `check:api`、`check:docs`、`schema:check`、`docs:build`；`publish.yml`：增加 `check:api`。
- 更新 `release-checklist.md`、`package-integrity.md`、`docs/README.md`、`README.md`、`AGENTS.md`、SKILL 中的文档路径与同步规则。

## 提交顺序

1. `docs(planning): record downstream handoff and docs site plan`
2. `docs(engineering): define public API stability tiers`
3. `refactor(types): return domain interfaces from services`
4. `refactor(types): name public option types and export missing results`
5. `refactor(types): narrow package root exports`
6. `fix(capabilities): align auth and method names`
7. `test(api): enforce public surface and docs coverage`
8. `feat(docs): scaffold VitePress site`
9. `docs(site): migrate downstream reference docs`
10. `docs(api): add service reference`
11. `docs(guide): add downstream guides`
12. `ci(docs): build docs site in CI`（部署由 Vercel Git 集成负责）
13. `chore(release): publish archive schemas and update release docs`

单个 commit 控制在 ≤10 文件 / ≤200 行；文档按 service 拆分。

## 验证门禁

- `pnpm run typecheck` / `pnpm exec eslint .` / `pnpm test --run`
- `pnpm check:api` / `pnpm check:docs` / `pnpm schema:check`
- `pnpm build` / `node scripts/browser-smoke.mjs --no-browser` / `pnpm test:bundle` / `pnpm verify:package`
- `pnpm docs:build`（死链检查）+ 本地 `pnpm docs:dev` 人工检查
- 部署后核验 `https://weibo-sdk.chilfish.top`、Vercel 域名绑定、HTTPS、`/schemas/weibo-user-archive/v2.json`

## 风险

- 导出移除与选项改名是 breaking：交接前做成本最低；先确认仓库内无包根导入依赖。
- VitePress 自带 vite 版本可能与工作区 `vite@^8` 冲突：vitepress 放独立 `catalogs.docs`，确认 `test:bundle` 仍解析工作区 vite。
- 自定义域名：在 Vercel 项目里绑定 `weibo-sdk.chilfish.top`，按面板提示配置 DNS；`base` 保持 `/`。
- `$schema` URL 变更会体现在新生成的归档文件里；读写不受影响，CHANGELOG 注明。
