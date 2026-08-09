# capture — CDP 浏览器抓取 SDK（weibo-sdk 附属工具）

> 通过 Chrome DevTools Protocol 驱动本机浏览器，自动化「打开已登录微博 → 触发 API → 读取网络请求/响应」，
> 直接产出真实 JSON，供**数据驱动开发**（抓真实 fixture）与**排障**（查看某端点的真实返回）使用。
> 调研背景见 [docs/engineering/browser-capture.md](../../docs/engineering/browser-capture.md)。

**形态**：项目内独立工具库（`capture/`），不进入主包 `weibo-sdk` 发布面；独立 CLI `pnpm capture`。

## 快速开始

```bash
# 前置：.env 含有效 WEIBO_COOKIE（node scripts/spike-diag.mjs 可验证）

# 抓用户主页触发的全部 API 响应（profile/mymblog/friendships...）
pnpm capture --uid 2365795232

# 抓单个端点
pnpm capture --url "https://weibo.com/ajax/statuses/show?id=RcD47f9xS"

# 落盘到指定目录（默认不落盘，只打印摘要）
pnpm capture --uid 2365795232 --out tests/fixtures/raw/cdp

# 有头模式（被风控时）+ 更长监听
pnpm capture --uid 2365795232 --headed --seconds 30
```

## CLI 参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--uid <uid>` | 导航到 `https://weibo.com/u/<uid>`（触发多 API） | — |
| `--url <url>` | 直接指定导航 URL（优先于 `--uid`） | — |
| `--host <host>` | cookie 注入 domain：`weibo.com` \| `weibo.cn` \| `m.weibo.cn` | `weibo.com` |
| `--out <dir>` | 落盘目录（含 `_index.json` 元信息）；不传则只打印摘要 | 不落盘 |
| `--seconds <n>` | 监听时长（秒） | `15` |
| `--headed` | 有头模式（默认 headless=new） | headless |
| `--port <n>` | 调试端口起点（自动找空闲） | `9222` |
| `--cookie <str>` | 覆盖 `.env` 的 WEIBO_COOKIE | `.env` |

## 编程 API（契约）

```ts
// capture/src/index.ts
export interface CaptureOptions {
  url?: string                                   // 导航 URL（与 uid 二选一，url 优先）
  uid?: string                                   // 微博 uid，导航到个人主页
  host?: 'weibo.com' | 'weibo.cn' | 'm.weibo.cn' // cookie 注入 domain
  seconds?: number                               // 监听时长（秒），默认 15
  headless?: boolean                             // 默认 true
  outDir?: string                                // 落盘目录（默认不落盘）
  port?: number                                  // 调试端口起点，默认 9222
  cookie?: string                                // 覆盖 .env WEIBO_COOKIE
  chromePath?: string                            // 覆盖 Chrome 可执行路径
  filter?: (url: string) => boolean              // 自定义请求过滤（默认 isApi）
}

export interface CaptureItem {
  url: string                                    // 请求 URL
  status: number                                 // HTTP 状态码
  mime?: string                                  // Content-Type
  ok?: number | boolean | string                 // 业务 ok 字段（undefined = 无 ok 字段）
  body: string                                   // 原始响应文本
  json?: unknown                                 // JSON.parse 结果（可解析时）
  file?: string                                  // 落盘文件名（outDir 内相对路径）
}

export function capture(options: CaptureOptions): Promise<CaptureItem[]>
```

**行为契约**：

- 只保留 JSON 响应；非 JSON（HTML/二进制）与业务失败响应（`ok` 存在且非 1/true）**不入结果**。
- 默认过滤：`weibo.com/ajax/*`、`weibo.cn/api/*`、`m.weibo.cn/api/*`；排除静态资源（js/css/img）与埋点 `log/action`、`log/rum`。
- `outDir` 提供时：每个响应写 `<outDir>/<NN>_<path>[_u<uid>][_p<page>].json` + `<outDir>/_index.json` 元信息。
- 结束后**总是**关闭 CDP 连接并 kill Chrome（`finally`），不残留进程。

## 依赖注入（可测性）

| 模块 | 职责 | 注入点 |
|---|---|---|
| `capture/src/cdp.ts` | CDP 客户端：`send(method, params)` / `on(method, handler)` | 构造注入 `sendRaw(text)`；测试用 `dispatch(msg)` 喂消息 |
| `capture/src/chrome.ts` | `buildChromeArgs(opts)`（纯函数）/ `spawnChrome` / `findFreePort` / `waitForEndpoint` | `findFreePort`/`waitForEndpoint` 可注入 fetch |
| `capture/src/cookie.ts` | `parseCookies(str, domain)`（纯函数） | — |
| `capture/src/filter.ts` | `isApi(url)` / `fileName(url, seq)`（纯函数） | — |
| `capture/src/capture.ts` | 编排：注入 cookie → 导航 → 收集 → 落盘 | deps 注入 `spawnChrome/findFreePort/connectCDP/writeFile` |

测试见 `tests/capture/`（全离线：fake Chrome 启动、fake CDP、纯函数）。

## 模块结构

```
capture/
  src/
    index.ts    公共 API 导出
    capture.ts  编排主流程
    cdp.ts      CDP 客户端
    chrome.ts   Chrome 启动 / 端口探测 / 参数构建
    cookie.ts   cookie 解析
    filter.ts   URL 过滤 / 文件名生成
    types.ts    类型定义
  bin/
    index.ts    CLI（citty）
  README.md     本手册
```

## 排障指引

| 症状 | 检查 |
|---|---|
| 无响应捕获 | `node scripts/spike-diag.mjs` 验证 cookie 是否有效；加 `--headed` 看是否 headless 被风控 |
| 全是 `ok:-100` / HTML | cookie 过期；从已登录浏览器重新导出 WEIBO_COOKIE |
| 端口冲突 | 自动找空闲端口；仍失败查 `.tmp/cdp-profile-*` 残留进程 |
| 响应体丢失（getResponseBody 报错） | 大响应/已卸载；加 `--seconds` 延长或 `--url` 精确导航 |

## 风险与边界

1. **只读**：仅导航 + 读响应，不产生写操作（防风控）。
2. **脱敏**：抓取数据含真实个人字段，`--out` 产物不入库；入库前按 `tests/fixtures/raw/INDEX.md` 脱敏。
3. **cookie 敏感**：`--cookie` 参数会出现在进程列表，避免长期明文；优先用 `.env`。
