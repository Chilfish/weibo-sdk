---
title: 运行环境
---

# 运行环境

## Node.js

- Node **>= 20.16**。
- ESM-only；CJS 用 `await import('@chilfish/weibo-sdk')`。
- 默认 transport 是 axios；代理、Cookie 文件、媒体落盘等 Node 能力需要 Node 运行时。
- `cookie` 传文件路径、`config.proxy` 的静态 URL / provider 只在 Node 侧有意义。

## Worker / Edge / Bun / Deno

```ts
import { fetchTransport, WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({ transport: fetchTransport() })
```

- 使用原生 fetch，不依赖 Node 内置模块。
- 不传 `cookie` 时自动使用访客身份；访客 token 发放也走注入的 fetch。
- 媒体下载需要可写目录，Worker / Edge 不适合直接调用；可只读 `ITweet.media` 的 URL。

## 浏览器 / 用户脚本

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk/browser'
```

- 该入口自包含 ESM，axios 与 zod 会一起打包，不需要额外的模块解析。
- 浏览器侧没有 Cookie 文件与代理；直接传 Cookie header 字符串或使用访客身份。
- 媒体下载受浏览器沙箱限制，建议只读取 URL 或由后端下载。

## 测试

```bash
pnpm test          # 默认离线；mock 传输
pnpm test:e2e      # 需要 .env 中的 WEIBO_COOKIE（WEIBO_E2E=1）
WEIBO_GUEST_E2E=1 pnpm test:e2e  # 访客链路，不需要 Cookie
```

## 构建产物

- `dist/index.mjs` + `dist/index.d.mts`：SDK
- `dist/browser.mjs`：浏览器入口
- `dist/cli.mjs` + `dist/cli-bin.mjs`：CLI 命令树与二进制入口
- `schemas/`：归档 JSON Schema（随包发布）
