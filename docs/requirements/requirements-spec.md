# 需求规格说明（Requirements Specification）

**文档状态**: v1.0 | **创建**: 2026-08-09 | **维护者**: 随功能变更同步更新

> 本文档是 `weibo-sdk` 的功能需求真相源（Source of Truth）。backlog、阶段计划（todo-*）、ADR 为本文件的派生执行文档。新增功能、架构变更、判断功能边界时，先阅读本文档。

---

## 1. 产品概述

### 1.1 产品愿景

`weibo-sdk` 是一个 **微博账号公开数据归档 SDK**：让开发者用最少代码、最可靠的方式，把一个微博账号的公开内容**完整镜像到本地**——可断点续传、可观测、默认离线可测。

### 1.2 产品定位

**定位为「数据归档工具链」**，而非「微博 API 通用封装」。用户的心智模型来自「备份 / 迁移 / 存档」这一类任务（iCloud 备份、Chrome 导出书签、git clone 整仓），而非「微博开放平台 API 客户端」。

> 来源：[review-apple-design-2026-08-09.md](../reviews/review-apple-design-2026-08-09.md) F1——「15 端点能力齐全，但缺一件被做到极致的事」。本文件把「个人数据归档」确立为那件事。

### 1.3 核心价值主张

| 价值 | 实现方式 |
|---|---|
| **契约稳定** | EndpointSpec + Zod 集中校验，normalized 领域模型兜底，屏蔽上游字段漂移 |
| **断点续传** | ArchiveService 提供可恢复的归档流（checkpoint 持久化），中断不重来 |
| **可观测** | Wide Events 覆盖归档全链路，故障可定位、进度可追踪 |
| **离线可测** | 默认 `pnpm test` 不依赖真实网络，E2E 显式门控 |
| **低上手成本** | 一个入口（`ArchiveService`）+ 一条 CLI 命令（`weibo-sdk archive`），≤20 行代码完成单账号镜像 |

### 1.4 技术约束

- **Runtime**: Isomorphic TypeScript（Node.js 为主，目标兼容 Browser/Edge）
- **HTTP**: axios（可注入替换）
- **协议校验**: Zod v4（`.passthrough()` 开放端点）
- **CLI**: citty（零依赖）
- **构建**: tsdown（Rolldown）

---

## 2. 目标用户与角色

### 2.1 用户画像

| 画像 | 特征 | 核心场景 |
|---|---|---|
| **个人存档开发者** | 想备份自己的微博数据 / 迁移账号 / 长期留档 | 全量镜像自己的微博、图片、收藏 |
| **数据分析者** | 抓取特定账号公开内容做研究 | 按时间范围拉取、导出结构化数据 |
| **归档工具构建者** | 用 SDK 二次封装（如导出为 Markdown/图床同步） | 复用 normalized 领域模型做下游转换 |

### 2.2 角色定义

| 角色 | 权限 | 说明 |
|---|---|---|
| **只读归档** | 公开数据（本人账号：全部；他人账号：公开内容） | SDK 不提供发布/删除/私信等写能力 |
| **Cookie 持有者** | 本人账号全量公开数据 | 依赖 `WEIBO_COOKIE` 会话 |

> **边界**：SDK 仅归档**公开可见**数据。私信、仅粉丝可见、付费内容不在范围内（见 §3.2）。

---

## 3. 范围（Scope）

### 3.1 范围内

- **账号数据镜像**：微博列表（`mymblog`）、按日期搜索（`searchProfile`）、转发（`repostTimeline`）、收藏（`favorites`）、用户信息/详情
- **关系数据**：关注列表、粉丝列表
- **媒体资源**：图片 / 视频 / 长图 / 视频封面 URL 与元数据
- **归档链路**：断点续传流、进度可观测、单一入口
- **数据导出基础**：normalized 领域模型（`User` / `Tweet`）+ 结构化错误

### 3.2 范围外

| 能力 | 原因 |
|---|---|
| 发布 / 点赞 / 转发 / 评论（写操作） | 归档是只读任务；写操作涉及风控与责任，非产品主线 |
| 私信 / 仅粉丝可见内容 | 超出「公开数据归档」范围，涉及他人隐私数据（产品决策，见 [backlog.md](../planning/backlog.md)） |
| 通用 API 封装的全量端点镜像 | 聚焦归档链，非归档端点只保留对归档有贡献的部分 |
| 数据渲染 / 前端 UI | SDK 是库 + CLI，不做展示层 |

---

## 4. 功能需求

> 编号供测试与计划引用。标注状态：✅ 已实现 / 🔜 计划中。

### F1 数据获取

| ID | 需求 | 状态 |
|---|---|---|
| F1.1 | 获取用户公开微博列表（分页 + 广告过滤） | ✅ `listByUserId` / `streamByUserId` |
| F1.2 | 按日期范围搜索用户微博 | ✅ `searchByDate` |
| F1.3 | 获取微博详情 / 长微博全文 | ✅ `show` / `longText` |
| F1.4 | 获取转发列表 | 🔜 todo-archive-mvp A1 |
| F1.5 | 获取收藏夹（含标签） | ✅ `getFavorites` / 🔜 A3 标签 |
| F1.6 | 获取关注 / 粉丝列表 | ✅ 关注 / 🔜 A2 粉丝 |
| F1.7 | 首页 Feed（双向关注时间线） | ✅ `listFriendTimeline` |

### F2 归档链路

| ID | 需求 | 状态 |
|---|---|---|
| F2.1 | 单一入口串起全部数据源 | 🔜 todo-archive-mvp A5 |
| F2.2 | 断点续传（checkpoint 持久化） | 🔜 todo-archive-mvp A6 |
| F2.3 | 全链路进度与事件可观测 | ✅ 事件打点 / 🔜 JSONL exporter |
| F2.4 | CLI 一键归档 | 🔜 todo-archive-mvp A8 |

### F3 数据契约

| ID | 需求 | 状态 |
|---|---|---|
| F3.1 | normalized 领域模型（`User`/`Tweet`）含 fallback 链 | ✅ |
| F3.2 | 结构化错误（code/level/retryable/context） | ✅ |
| F3.3 | 公开 API 类型以真实响应为准（`sinceId: string`） | 🔜 todo-archive-mvp P0-2 |
| F3.4 | 版本单一来源 + semver 策略 | 🔜 todo-archive-mvp P0-1 |

### F4 可观测性与诊断

| ID | 需求 | 状态 |
|---|---|---|
| F4.1 | Wide Events 覆盖 Happy/Error Path | ✅ |
| F4.2 | 事件有消费端（JSONL exporter 示例） | 🔜 todo-archive-mvp E4 |
| F4.3 | 错误排障手册（`error-diagnostics.md`） | ✅ |

---

## 5. 非功能需求

| 类别 | 需求 | 验证方式 |
|---|---|---|
| **可维护性** | 模块边界清晰、EndpointSpec 单一路径、禁止内联 schema | code review / lint |
| **可测试性** | 默认离线可跑；每个功能有对应测试；schema 变更触发全量回归 | `pnpm test` + validate-fixtures 脚本 |
| **开发者体验** | 完整类型推导、TSDoc 覆盖、快速开始示例 | typecheck / 文档 |
| **可观测性** | 关键路径全链路 trace；`telemetry.emit` 失败不影响 SDK | 事件断言测试 |
| **数据驱动** | 新增/修改 schema 前必须先取真实 fixture | CLAUDE.md 硬约束 |

---

## 6. 溯源

| 需求来源 | 文档 |
|---|---|
| 产品定位决策（个人数据归档） | [review-apple-design-2026-08-09.md](../reviews/review-apple-design-2026-08-09.md) F1 |
| 归档 MVP 计划 | [todo-archive-mvp.md](../planning/todo-archive-mvp.md) |
| 候选任务 | [backlog.md](../planning/backlog.md) |
| 架构决策 | [architecture.md](../planning/architecture.md) |
