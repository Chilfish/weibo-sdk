# 文档索引

> `weibo-sdk` 文档中央索引。所有文档按分类组织，新增文档请登记到对应分类。
> 约定：**文档即事实** —— 文档必须与代码一致，不一致以代码为准并修正文档；**文档先行** —— 写码前先更新文档。

## 契约与需求（requirements/）

| 文档 | 说明 |
|---|---|
| [微博 SDK 技术规格书](微博SDK技术规格书_v2.0.md) | 分层架构、实体契约（IUser/ITweet）、接口定义、错误体系、可测试性（与实现对齐） |
| [术语表](requirements/glossary.md) | 意见性术语（领域/协议/架构/可观测性），含 Avoid 列表 |
| [项目概览](项目概览.md) | 面向新人的项目介绍：分层、Endpoint 管理、服务能力速览、可测试性 |

## 规划（planning/）

| 文档 | 说明 |
|---|---|
| [架构决策记录](planning/architecture.md) | ADR-001~012：关键架构决策与取舍（含 NOT ADOPTED / SUPERSEDED 记录） |
| [渐进式开发计划](渐进式开发计划.md) | 当前状态、路线图、真实数据获取操作手册、Fixture 清单 |
| [TODO / Next Steps](TODO.md) | 当前进度与待做清单（P0/P1/P2） |

## 工程（engineering/）

| 文档 | 说明 |
|---|---|
| [CLI 命令参考](CLI.md) | 全部 14 个子命令、输出形态、架构 |
| [错误排障手册](error-diagnostics.md) | 结构化错误码表、诊断流程、决策树 |
| [SDD 规范（SKILL）](SKILL.md) | 规格驱动开发、Wide Events、SDK 架构九条宪法 |

## 项目记录

| 文档 | 说明 |
|---|---|
| [开发日志](development-log/README.md) | 按天记录，含索引与约定 |
| [Postmortem](postmortem/README.md) | 尸检报告索引 + **高频雷区自查清单**（写码前必读）+ 模板 |
| [归档](archive/README.md) | 已完成阶段文档归档处（历史记录，不主动读取） |

## 根目录文档

| 文档 | 说明 |
|---|---|
| [../README.md](../README.md) | 项目介绍、快速开始、API 示例 |
| [../CLAUDE.md](../CLAUDE.md) | 仓库级硬约束（数据驱动开发 / CLI Mandate / 合并门禁等） |
| [../CHANGELOG.md](../CHANGELOG.md) | 变更日志 |
| [../LICENSE.md](../LICENSE.md) | MIT License |

## 约定

- 所有文档使用中文（README / CHANGELOG / LICENSE 除外）。
- **文档先行**：每个任务第一步先更新相关文档（开发日志、任务状态、方案文档），再开始写代码；实施中随反馈同步修改，而非事后补记。
- **文档即事实**：发现文档与代码不一致，以代码为准并修正文档。
- **归档**：完成阶段的规划文档移入 `archive/`——存档 = 历史记录，不主动读取；活跃文档只留在本文档对应的分类下。
- **Postmortem**：遇到返工/事故，按 `docs/postmortem/TEMPLATE.md` 沉淀一条，并更新「高频雷区」。
- 开发日志按天记录在 `development-log/`（新的一天新建 `YYYY-MM-DD.md`）。
