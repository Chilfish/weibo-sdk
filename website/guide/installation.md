---
title: 安装与环境
---

# 安装与环境

## 安装

```bash
pnpm add @chilfish/weibo-sdk
# 或
npm install @chilfish/weibo-sdk
```

CLI 随包安装：

```bash
npx weibo-cli --version
# 或全局安装
npm i -g @chilfish/weibo-sdk
```

## 环境要求

| 项 | 要求 |
|---|---|
| Node.js | >= 20.16（与 `process.getBuiltinModule` 对齐） |
| 模块格式 | ESM。CJS 调用方使用 `await import('@chilfish/weibo-sdk')` |
| 运行时依赖 | `axios`、`zod`；CLI 的 `citty` 已内联进产物 |
| 浏览器 | 使用 `@chilfish/weibo-sdk/browser` 子路径，axios 与 zod 一起打包 |

## 入口

| 子路径 | 用途 |
|---|---|
| `@chilfish/weibo-sdk` | Node / Bun / Deno / Worker 的 SDK 入口 |
| `@chilfish/weibo-sdk/browser` | 浏览器 / 用户脚本，自包含 ESM |
| `@chilfish/weibo-sdk/cli` | CLI 命令树（无顶层副作用）；二进制入口由 `weibo-cli` 提供 |
| `@chilfish/weibo-sdk/schemas/*` | 归档 JSON Schema，可离线校验 |

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'
import { WeiboSDK as BrowserSDK } from '@chilfish/weibo-sdk/browser'
```

## 运行时边界

归档续跑状态通过 `UserArchiveStore` 交给调用方保存；CLI 用文件实现，并在输出文件旁维护 `.slices/` 与 raw sidecar。

npm 包包含 `dist/`、`schemas/`、README、LICENSE 和 package.json。
