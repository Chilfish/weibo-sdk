---
title: 指南
---

# 指南

| 文档 | 内容 |
|---|---|
| [安装与环境](/guide/installation) | Node 版本、ESM / CJS、浏览器子路径与 CLI 安装 |
| [快速开始](/guide/quick-start) | 用户、微博、流式读取与归档的最小示例 |
| [鉴权与访客模式](/guide/authentication) | `auth: 'auto' \| 'cookie' \| 'guest'`、Cookie 来源、会话查询 |
| [分页与流式读取](/guide/pagination-streaming) | `list*` 与 `stream*` 的游标、去重、停止条件、日期边界 |
| [错误、重试与限流](/guide/errors-retries) | 错误码、重试策略、432 / 429 的处理方式 |
| [归档账号](/guide/archive) | `archive` / `userArchive` / `merge` 三条路径与续跑语义 |
| [下载媒体](/guide/media) | URL 有效期、下载选项、失败清单与安全边界 |
| [遥测与日志](/guide/observability) | Wide Events、`hooks.onRaw`、logger 接入与脱敏 |
| [传输与插件](/guide/extending) | 替换 axios、Worker / Edge 环境、插件生命周期 |
| [运行环境](/guide/environments) | Node / Worker / 浏览器扩展的可用面 |
| [范围与限制](/guide/limitations) | 只读边界、访客限制、已知上游问题 |

## 命名约定

| 前缀 | 行为 | 返回 |
|---|---|---|
| `get*` | 读取实体或一页数据 | 领域模型（`ITweet` / `IUser` / `*PageResult`） |
| `list*` | 读取一页 | `*PageResult`，带下一页游标 |
| `stream*` | 自动翻页 | `AsyncIterableIterator<T>` |
| `fetchRaw*` | 读取上游原始响应 | 与微博接口同形的 snake_case 数据 |

`get*` / `list*` / `stream*` 返回归一化后的 camelCase 领域模型；`fetchRaw*` 是唯一会返回上游 snake_case 数据的入口。

时间倒序的流支持 `since` / `until`；所有流支持 `maxItems` / `maxPages` / `onProgress`。参数使用 camelCase，上游原始查询参数（例如 `searchByDate` 的 `starttime`）保持原样。接受 `mblogId` 的方法同时接受数字 mid 与微博状态 URL。

实现细节见 [API 参考](/api/)。
