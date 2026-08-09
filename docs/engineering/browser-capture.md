# 浏览器自动化（CDP）真实数据获取 — 调研与操作手册

> 状态：调研完成，方案已验证（2026-08-09）
> 用途：数据驱动开发（[roadmap](../planning/roadmap.md#真实数据获取操作手册)）的**可复现**真实数据来源，
> 替代一次性手工 DevTools 抓包。

## 背景

本项目正确性以真实微博 API 响应为准（数据驱动开发）。此前真实数据来自手工 DevTools 抓包 →
`tests/fixtures/raw/captures/` → [`scripts/process-captures.mjs`](../../scripts/process-captures.mjs)
管线，但该流程是**一次性、非自动化**的，且依赖人工打开 DevTools 导出。

目标：用 **Chrome DevTools Protocol（CDP）** 驱动浏览器，自动化「打开已登录微博 → 触发 API → 读取请求/响应」，直接产出真实 JSON fixture，可随时复现。

## 调研结论（2026-08-09）

### 候选方案

| 方案 | 维护方 | 连接已登录浏览器 | 读网络请求 | 接入方式 |
|---|---|---|---|---|
| **chrome-devtools-mcp** | Google | `--browser-url=http://127.0.0.1:9222`（需独立 profile 调试端口启动） | `list_network_requests`（过滤）/ `get_network_request`（body 可落盘） | `claude mcp add chrome-devtools npx chrome-devtools-mcp@latest` |
| **Playwright MCP** | Microsoft | `--user-data-dir` 指向本机 profile / `--extension` / `--cdp-endpoint` | `browser_network_requests` / `browser_network_request`（需 `--caps=network`） | `claude mcp add playwright npx @playwright/mcp@latest` |
| **Browser Control MCP**（Chrome 扩展） | 社区 | 直接接管当前正用标签页，登录态天然继承 | 基于 DevTools network 面板 | Chrome 扩展 + 本地 MCP server |
| **browser-use** | Browser-use 团队 | `-b real` 加载真实 Chrome Profile（登录态/反爬最强） | 框架内部采集 | `pip install browser-use` |
| **原生 CDP 脚本**（本项目采用） | 自研 | CDP 启动独立 Chrome + `Network.setCookie` 注入 `.env` cookie | `Network.responseReceived` + `Network.getResponseBody` | Node 24 原生 WebSocket，零依赖 |

### 选型决策

**本项目采用「原生 CDP 脚本」**，理由：

1. **不依赖外部浏览器进程**：本机 Chrome 日常使用中，无法用 `--remote-debugging-port` 重启（会打断用户会话）。
   用独立 profile + cookie 注入，零干扰、可复现。
2. **`.env` cookie 已验证有效**（`spike-diag.mjs` → `bandUnified` 返回 `ok:1`），无需浏览器手动登录。
3. **结果直接落盘为 JSON fixture**，与 `process-captures.mjs` 管线互补（该管线处理的是 DevTools HTTP/2 capture 文本）。
4. MCP 方案（chrome-devtools-mcp / Playwright MCP）适合**交互式调试**：`claude mcp add` 后重启会话即可用，
   用于"想随机观察某个请求"的场景；脚本方案适合**批量/定时/回归**抓取。两者并存，按需选择。

## 操作手册：`scripts/spike-cdp-capture.mjs`

### 前置条件

- 本机 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`）或 Edge
- `.env` 含有效 `WEIBO_COOKIE`（验证方法见下方「验证」）

### 原理

```
Node 脚本
 ├─ spawn Chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<独立profile>
 ├─ fetch http://127.0.0.1:9222/json  → 取 page WebSocket 地址
 ├─ CDP: Page.enable + Network.enable + Network.setCookies（解析 .env cookie，domain=.weibo.com）
 ├─ CDP: Page.navigate 到目标 URL（如 /u/{uid}）
 ├─ 监听 Network.responseReceived，过滤 weibo.com/ajax/* 或 m.weibo.cn/api/*
 └─ Network.getResponseBody → 保存 JSON 到 tests/fixtures/raw/cdp/{name}.json
```

### 用法

```powershell
node scripts/spike-cdp-capture.mjs --uid 2365795232 --out tests/fixtures/raw/cdp
# 可选：--url 直接指定导航 URL；--seconds 监听时长（默认 15s）
```

### 输出

- 每个匹配请求的响应 JSON 落盘到 `--out` 目录（默认 `tests/fixtures/raw/cdp/`）
- stdout 打印每个请求的 `method url → HTTP status / body 大小 / ok 字段`
- 结束后自动 kill Chrome

### 验证 cookie 有效性（快速）

```bash
node scripts/spike-diag.mjs
# 期望第 2 行：band env cookie+浏览器头 => ok:1
```

## 与现有管线的分工

| 管线 | 输入 | 输出 | 用途 |
|---|---|---|---|
| `process-captures.mjs` | DevTools 导出的 HTTP/2 capture 文本 | 脱敏 fixture + INDEX | 一次性深挖某端点变种 |
| `spike-cdp-capture.mjs` | CDP 驱动浏览器 | 原始 JSON fixture（未脱敏） | 可复现批量抓取、回归刷新 |

> 两个管线产出的 fixture 均需按 `tests/fixtures/raw/INDEX.md` 脱敏规则处理后再入库。

## 风险与注意

1. **Cookie 会过期**：抓取失败先跑 `spike-diag.mjs` 验证；过期需从已登录浏览器重新导出。
2. **headless 风控**：微博可能对 headless UA 返回 `ok:-100`/HTML。若发生，`--headed` 参数改用有头模式（仍用独立 profile）。
3. **个人数据脱敏**：响应含真实 uid/昵称/ID，入库前必须脱敏（≤40 字符短串保留以维持关联，见 postmortem 006）。
4. **只读操作**：脚本只导航与读响应，不产生点赞/评论等写操作，避免触发风控。
5. **端口冲突**：若 9222 已被占用，自动换端口（脚本内处理）。

## 参考

- [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)（调研于 2026-08-09）
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- [Claude Code 浏览器自动化方案实测对比（2026）](https://www.heyuan110.com/zh/posts/ai/2026-01-28-claude-code-browser-automation/)
