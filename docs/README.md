# 文档索引

> `weibo-sdk`（npm: `@chilfish/weibo-sdk`，CLI: `weibo-cli`）文档中央索引。所有文档按分类组织，新增文档请登记到对应分类。
> 约定：**文档即事实** —— 文档必须与代码一致，不一致以代码为准并修正文档；**文档先行** —— 写码前先更新文档。

## 产品定位

**个人数据归档**（2026-08-09 产品决策）：`weibo-sdk` = 可靠地把一个微博账号的公开数据镜像下来——可断点续传、可观测、默认离线可测。npm 包名为 `@chilfish/weibo-sdk`，CLI 为 `weibo-cli`。详见 [requirements/requirements-spec.md](requirements/requirements-spec.md) 与 [reviews/review-apple-design-2026-08-09.md](reviews/review-apple-design-2026-08-09.md)。

> **发布形态**（2026-10-19）：发布为 npm 包 `@chilfish/weibo-sdk`（CLI 二进制 `weibo-cli`），被 `I:\dev\Weibo-archiver` 的 web-v3（SPA）/ monkey / CLI 消费，`ITweet` 定为下游存档终局契约。见 [reviews/review-apple-design-2026-08-10.md](reviews/review-apple-design-2026-08-10.md) 与 [archive/todo-contract-freeze.md](archive/todo-contract-freeze.md)（契约冻结阶段，已归档）。

---

## Agent 使用文档

| 文档 | 说明 | 何时阅读 |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | 仓库级开发约束 + SDK/CLI 使用速查（安装 / 登录 / 命令 / 分页 / 错误码 / 边界） | 任何开发任务开始前 |
| [.agents/skills/weibo-sdk/SKILL.md](../.agents/skills/weibo-sdk/SKILL.md) | Agent 技能（按 skill-creator 模板：指令 / 示例 / 故障排除 / 边界） | 用 SDK/CLI 取数、归档或新增端点 |

## playground/ — 可运行示例

| 文档 | 说明 |
|---|---|
| [playground/README.md](../playground/README.md) | 场景化 SDK / CLI 示例、Quick Start、`pnpm play` 用法与排障 |
| [playground/cli/README.md](../playground/cli/README.md) | CLI 命令食谱（复制即用，含 NDJSON 管道消费） |

## requirements/ — 需求文档

| 文档 | 说明 | 何时阅读 |
|---|---|---|
| [requirements-spec.md](requirements/requirements-spec.md) | 需求规格说明（PRD）：产品愿景（个人数据归档）/ 范围 / 功能需求 / 非功能需求 / 溯源 | 新增功能、判断功能边界 |
| [glossary.md](requirements/glossary.md) | 意见性术语表（领域/协议/架构/可观测性），含 Avoid 列表 | 理解领域术语 |
| [overview.md](requirements/overview.md) | 面向新人的项目介绍：分层、Endpoint 管理、服务能力速览、可测试性 | 初次接触项目 |

## planning/ — 架构与规划

| 文档 | 说明 | 何时阅读 |
|---|---|---|
| [architecture.md](planning/architecture.md) | 架构决策记录（ADR-001~012），含 NOT ADOPTED / SUPERSEDED | 任何架构级变更前 |
| [roadmap.md](planning/roadmap.md) | 开发路线图（Phase 1-6）、真实数据获取操作手册、Fixture 清单 | 规划端点/测试/数据 |
| [research-weibo-ecosystem-2026-10-19.md](planning/research-weibo-ecosystem-2026-10-19.md) | 同类活跃项目调研（API 逆向 / CLI / 归档），含可借鉴设计与差距映射 | 规划 P1/P2 顺序、评估功能边界 |
| [research-guest-mode-2026-10-20.md](planning/research-guest-mode-2026-10-20.md) | 无登录访客模式（guest mode）调研：token 发放、真实端点矩阵、匿名翻页边界、SDK 接入方案与 P0/P1/P2 行动计划 | 规划 guest mode / 评估匿名读取能力 |
| [backlog.md](planning/backlog.md) | 跨阶段候选任务清单（收拢暂缓项，含状态图例） | 规划下一阶段 |
| [todo-guest-mode.md](planning/todo-guest-mode.md) | 访客模式行动计划：已拍板决策、G1–G7 范围、测试计划、提交顺序与风险 | 实施 / 验收 guest mode |

## reviews/ — 代码审查记录

| 文档 | 说明 | 何时阅读 |
|---|---|---|
| [review-apple-design-2026-08-09.md](reviews/review-apple-design-2026-08-09.md) | Apple 产品/研发视角设计审查（F/C/E/D 问题清单 + 评分 + 根因） | 了解已知设计问题、行动依据 |
| [review-apple-design-2026-08-10.md](reviews/review-apple-design-2026-08-10.md) | 第二轮 Apple 视角审查（下游契约 K / 归档硬化 R，npm 发布 + 真实消费者背景） | 了解发布前必须解决的契约/归档问题 |

## engineering/ — 工程规范与子系统

| 文档 | 说明 | 何时阅读 |
|---|---|---|
| [technical-spec.md](engineering/technical-spec.md) | 架构与契约规格（分层、实体契约、接口定义、错误体系、可测试性） | 任何实现/契约变更 |
| [git-workflow.md](engineering/git-workflow.md) | 分支模型、Commit 规范、验证门禁、PR/合并、发布 | 每次 commit / PR |
| [code-style.md](engineering/code-style.md) | TS 命名、文件组织、分层约束、禁止事项、测试规范 | 写代码前 |
| [release-checklist.md](engineering/release-checklist.md) | 里程碑发布清单（验证门禁 + 导出面核验 + E2E 冒烟） | 发布前 |
| [cli.md](engineering/cli.md) | CLI 命令参考与架构说明（citty，二进制 `weibo-cli`） | 添加/修改 CLI 子命令 |
| [endpoint-authoring.md](engineering/endpoint-authoring.md) | 端点开发指南：抓包 → schema → spec → service → CLI → 测试 → 文档；含分页约定与高频雷区 | 新增/修改任何 endpoint |
| [media-download.md](engineering/media-download.md) | 单条微博媒体下载：命名、安全、重试、失败清单 | 修改下载行为 / 排障 |
| [error-diagnostics.md](engineering/error-diagnostics.md) | 错误排障手册（结构化错误码表、排查流程） | 排障时 |
| [skill.md](engineering/skill.md) | SDD（规格驱动开发）、Wide Events、Structured Error 等工程规范 | 理解可观测性/SDD |
| [browser-capture.md](engineering/browser-capture.md) | CDP 浏览器自动化抓取调研与方案（对应 `capture/` SDK，见 `capture/README.md`） | 真实数据获取 / 排障 |
| [opencli-browser-bridge.md](engineering/opencli-browser-bridge.md) | OpenCLI Browser Bridge 操作手册：复用已登录 Chrome 抓包、发现未知端点、模拟点击触发 XHR | 端点验证 / 抓真实 fixture / 浏览器自动化 |

## postmortem/ — 事后分析

| 文档 | 说明 |
|---|---|
| [README.md](postmortem/README.md) | 索引 + **高频雷区自查清单**（写码前必读）+ 模板 |
| [001-010](postmortem/README.md#索引表) | 历次尸检报告 |

## development-log/ — 开发日志

| 文档 | 说明 |
|---|---|
| [README.md](development-log/README.md) | 按天日志索引与约定 |
| [2026-08-09.md](development-log/2026-08-09.md) | 当日记录 |
| [2026-08-10.md](development-log/2026-08-10.md) | 当日记录（契约冻结规划） |
| [2026-09-04.md](development-log/2026-09-04.md) | 当日记录（契约冻结 P0 实施） |
| [2026-10-19.md](development-log/2026-10-19.md) | 当日记录（Cookie 来源收口 / 真实 E2E 回归 / 生态调研） |
| [2026-10-20.md](development-log/2026-10-20.md) | 当日记录（0.1.0 发布 / 0.1.1 重发 / 用户数据能力 / 0.2.0 发布准备） |

## archive/ — 存档（历史记录，不主动读取）

| 文档 | 说明 |
|---|---|
| [README.md](archive/README.md) | 归档约定 + 目录 |
| [todo.md](archive/todo.md) | 早期 TODO（历史记录，已完成项已归档） |
| [todo-archive-mvp.md](archive/todo-archive-mvp.md) | 归档 MVP 计划（已完成，承接见 [todo-contract-freeze.md](archive/todo-contract-freeze.md)） |
| [todo-contract-freeze.md](archive/todo-contract-freeze.md) | 上一阶段行动计划：契约冻结 + 归档硬化（P0/P1/P2 + DoD 全部完成，0.1.0 已发布）——历史记录，不主动读取 |
| [todo-post-0.1.0.md](archive/todo-post-0.1.0.md) | 上一阶段行动计划：0.1.0 发布 + 0.2 数据面 / 可靠性 / DX（已完成并归档，含不再推进项说明）——历史记录，不主动读取 |

---

## 约定

- 所有文档使用中文（README / CHANGELOG / LICENSE 除外）。
- **文档先行**：每个任务第一步先更新相关文档（开发日志、任务状态、方案文档），再开始写代码；实施中随反馈同步修改，而非事后补记。
- **文档即事实**：发现文档与代码不一致，以代码为准并修正文档。
- **归档**：完成阶段的规划文档移入 `archive/`——存档 = 历史记录，不主动读取；活跃文档只留在对应分类下。
- **Postmortem**：遇到返工/事故，按 `postmortem/TEMPLATE.md` 沉淀一条，并更新「高频雷区」。
- **开发日志**按天记录在 `development-log/`（新的一天新建 `YYYY-MM-DD.md`）。
- **审查**：重要评审/迭代后，在 `reviews/` 记录审查结论（`review-YYYY-MM-DD-<slug>.md`），作为行动计划依据。
