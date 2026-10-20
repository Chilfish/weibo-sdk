# 浏览器抓取方案选型（背景与决策）

> 状态：已落地。本文只保留**为什么这样选**；具体操作看两处：
> - `capture/` SDK 的 API 与 CLI 契约：[`capture/README.md`](../../capture/README.md)
> - 复用已登录 Chrome 的抓包手册：[`opencli-browser-bridge.md`](./opencli-browser-bridge.md)
>
> 用途：记录数据驱动开发中「真实响应从哪来」的选型依据，避免重复调研或走回一次性手工 DevTools 抓包。

## 背景

本项目正确性以真实微博 API 响应为准（数据驱动开发）。早期真实数据来自手工 DevTools 抓包 →
`tests/fixtures/raw/captures/` → [`scripts/process-captures.mjs`](../../scripts/process-captures.mjs)，
流程**一次性、非自动化**，且依赖人工打开 DevTools 导出。

目标：自动化「打开已登录微博 → 触发 API → 读取请求/响应」，产出可复现的真实 JSON fixture。

## 候选方案（调研于 2026-08-09）

| 方案 | 维护方 | 连接已登录浏览器 | 读网络请求 | 接入方式 |
|---|---|---|---|---|
| **chrome-devtools-mcp** | Google | `--browser-url=http://127.0.0.1:9222`（需独立 profile 调试端口启动） | `list_network_requests` / `get_network_request` | MCP server |
| **Playwright MCP** | Microsoft | `--user-data-dir` / `--extension` / `--cdp-endpoint` | `browser_network_requests`（需 `--caps=network`） | MCP server |
| **Browser Control MCP**（Chrome 扩展） | 社区 | 直接接管当前标签页，登录态天然继承 | 基于 DevTools network 面板 | 扩展 + 本地 server |
| **browser-use** | Browser-use 团队 | `-b real` 加载真实 Chrome Profile | 框架内部采集 | Python 框架 |
| **原生 CDP 脚本**（本项目采用） | 自研 | CDP 启动独立 Chrome + `Network.setCookie` 注入 `.env` cookie | `Network.responseReceived` + `Network.getResponseBody` | Node 原生 WebSocket，零依赖 |

## 选型决策

采用「原生 CDP 脚本」，理由：

1. **不侵入日常浏览器**：本机 Chrome 日常使用中，无法用 `--remote-debugging-port` 重启（会打断会话）。
   独立 profile + cookie 注入，零干扰、可复现。
2. **`.env` cookie 已验证有效**，无需浏览器手动登录。
3. **结果直接落盘为 JSON**，可脚本化、可 headless、可离线测试。
4. MCP 方案更适合**交互式调试**（`claude mcp add` 后随会话可用），而脚本方案适合**批量 / 定时 / 回归**；
   两者按需并存。

## 两条抓包通道的分工

这是本项目唯一的「选哪条」判断依据，详细对比见
[`opencli-browser-bridge.md` §1](./opencli-browser-bridge.md#1-三种抓包路径怎么选)：

| 通道 | 入口 | 什么时候用 |
|---|---|---|
| OpenCLI browser bridge | 已登录 Chrome + OpenCLI 扩展 | **日常逆向首选**：复放已知端点、发现未知端点（`network` shape 预览）、点击触发 XHR |
| `capture/` + `pnpm capture` | 独立 profile + `.env` cookie | 需要固化、批量、无人值守或回归刷新时 |

关键差异：`capture/` 只能「导航 + 收响应」，**无法主动点击**，因此发现未知端点仍要靠 OpenCLI；
反过来 OpenCLI 依赖外部 daemon / 扩展 / 打开的浏览器，不能进 CI。

## 历史：`scripts/spike-cdp-capture.mjs`（legacy）

该脚本是 `capture/` 的前身，2026-08-09 用于验证「headless 未被风控、可抓到 10 个 `ok:1` 响应」。
能力已被 `pnpm capture` 覆盖，仅作对照保留，**不要在新流程里使用**。

## 风险与注意

1. **Cookie 会过期**：抓取失败先验证 cookie（`node scripts/spike-diag.mjs`），过期需从已登录浏览器重新导出。
2. **headless 风控**：微博可能对 headless UA 返回 `ok:-100` / HTML。可改用有头模式（仍用独立 profile）。
3. **个人数据脱敏**：响应含真实 uid / 昵称 / ID，入库前必须脱敏（规则见 `tests/fixtures/raw/INDEX.md`）。
4. **只读操作**：只导航与读响应，不产生点赞 / 评论等写操作。
5. **端口冲突**：调试端口自动寻找空闲端口。

## 参考

- [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- [Claude Code 浏览器自动化方案实测对比（2026）](https://www.heyuan110.com/zh/posts/ai/2026-01-28-claude-code-browser-automation/)
