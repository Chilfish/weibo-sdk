---
title: 指南
---

# 指南

| 文档 | 先读它的理由 |
|---|---|
| [安装与环境](/guide/installation) | 确认 Node 版本、ESM / CJS、浏览器子路径与 CLI 安装方式 |
| [快速开始](/guide/quick-start) | 用最少代码跑通用户、微博、流式读取与归档 |
| [鉴权与访客模式](/guide/authentication) | `auth: 'auto' \| 'cookie' \| 'guest'` 的差异、Cookie 来源与失效行为 |
| [分页与流式读取](/guide/pagination-streaming) | `list*` 与 `stream*` 的游标、去重、停止条件、日期边界 |
| [错误、重试与限流](/guide/errors-retries) | 判断 `code`、重试策略、432 / 429 的处理方式 |
| [归档账号](/guide/archive) | `archive` / `userArchive` / `merge` 三条路径与续跑语义 |
| [下载媒体](/guide/media) | URL 过期、下载选项、失败清单与安全边界 |
| [遥测与日志](/guide/observability) | Wide Events、`hooks.onRaw`、logger 接入与脱敏 |
| [传输与插件](/guide/extending) | 替换 axios、Worker / Edge 环境、插件生命周期 |
| [运行环境](/guide/environments) | Node / Worker / 浏览器扩展的可用面 |
| [范围与限制](/guide/limitations) | 只读边界、访客限制、已知上游问题 |

## 稳定性约定

包根的公开面分三层，详见 [API 参考 · 如何阅读](/api/)：

- **稳定**：受 SemVer 承诺。0.x 内破坏性变更会给出迁移说明。
- **实验性**：可用，但返回原始上游形状或辅助函数，可能随上游漂移。
- **内部**：不从包根导出。

文档站的 API 页面与 `api-surface.json` 由 CI 校验覆盖率，方法不存在或文档缺失会让 `pnpm check:api` 失败。
