# Weibo Archive App（消费端应用）

> **状态**：调研完成，POC 未开始（2026-10-26）。
> **目标**：把 `@chilfish/weibo-sdk` 包装成一个零命令行、本地优先的桌面应用，让没有编程经验的微博用户也能完成「备份自己的微博 → 离线浏览 → 搜索 → 导出」。
> **前身**：[Chilfish/Weibo-archiver](https://github.com/Chilfish/Weibo-archiver)（油猴脚本抓取 + 网页查看器 + Go 本地服务器）。

## 项目关系

| 项目 | 角色 | 状态 |
|---|---|---|
| `@chilfish/weibo-sdk`（本仓库） | **引擎**：抓取、归一化、归档、契约、CLI | 0.6.0 已发布 |
| Weibo Archive App（本文档描述的消费端） | **产品**：桌面应用，负责登录、进度、存储、浏览、导出 | 待立项 |
| 老 Weibo-archiver | **前身**：验证过需求与用户量，但数据格式与前端均需重做 | 历史项目，后续演进由新应用承接 |

**边界**：应用不新增微博端点、不复制抓取逻辑；所有上游交互都通过 SDK。SDK 不为应用新增 Node 依赖或文件系统耦合。

## 产品定位

**本地优先的微博备份与回忆应用。**

- 卖点不是「爬虫」，是「号没了也有备份」「十年的微博能翻」。
- 数据只存在本机，不上传、不建云账号、不做社交功能。
- 只有一种主流程：登录 → 点「开始备份」→ 看进度 → 浏览 / 搜索 / 导出。
- 高级参数（时间范围、评论页数、并发）默认折叠，不阻塞主流程。

## 技术形态结论（详见调研）

- **桌面应用**，不做纯网页抓取：浏览器禁止设置 `Cookie` 头、微博不开放 CORS、媒体有 Referer 校验、IndexedDB 不适合大归档。
- 宿主选 **MyGo（Go + 系统 WebView）**：`mygo.Cookies` 能读 HttpOnly Cookie，`@mygo-plugins/fetch` 从 Go 发请求且不受 CORS 限制，正好接上 SDK 的 `fetchTransport({ fetch })`。
- **SDK 跑在 WebView 里，Go 只做特权 I/O**：登录态、网络出口、文件、SQLite。不把 SDK 移植到 Go，也不塞 Node sidecar。
- 长任务用 SDK 的 `UserArchiveStore` 端口落 SQLite，页面关闭后重开可续跑。
- 网页端保留为**只导入查看器**（可选），不承担抓取。

## 文档索引

| 文档 | 内容 |
|---|---|
| [research-mygo-app-2026-10-26.md](research-mygo-app-2026-10-26.md) | 完整调研事实：前身项目、SDK 契约与端口、MyGo 能力、交叉约束、数据兼容映射、未验证假设 |
| [poc-plan-mygo-sdk-integration.md](poc-plan-mygo-sdk-integration.md) | POC 计划：先证明「MyGo 里能跑 SDK」，M0–M5 步骤、验收、Go/No-Go |
| [build-plan.md](build-plan.md) | POC 通过后的构建方案：架构、数据层、前端、迁移、分发与阶段计划 |

## 当前下一步

1. 按 POC 计划搭独立仓库的骨架，先用**固定 Cookie**（不发登录流程）跑通 MyGo fetch → SDK 请求。
2. 再补登录窗口与 `mygo.Cookies`，验证 Windows / macOS 两端。
3. POC 全绿后再进入构建阶段；任一致命项失败则回退 Electron（SDK 与 UI 不变，只换宿主层）。
