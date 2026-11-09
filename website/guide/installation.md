---
title: 安装与环境
description: 安装 SDK 与 CLI，确认 Node 版本要求与各个导出子路径的用途。
---

# 安装与环境

## 安装

```bash
pnpm add @chilfish/weibo-sdk
# 或
npm install @chilfish/weibo-sdk
# 或
bun add @chilfish/weibo-sdk
```

CLI 随包安装。包名是 `@chilfish/weibo-sdk`，可执行文件名是 `weibo-cli`：

```bash
# npm 上的 weibo-cli 是另一个第三方包，用 -p 指定本包
npx -p @chilfish/weibo-sdk weibo-cli --version
bunx -p @chilfish/weibo-sdk weibo-cli --version

# 全局安装
npm i -g @chilfish/weibo-sdk
bun add -g @chilfish/weibo-sdk
```

## 环境要求

| 项 | 要求 |
|---|---|
| Node.js | >= 20.16（与 `process.getBuiltinModule` 对齐） |
| 模块格式 | ESM。CJS 调用方使用 `await import('@chilfish/weibo-sdk')` |
| 运行时依赖 | `axios`、`zod`；CLI 的 `citty` 已内联进产物 |
| 浏览器 | 使用 `@chilfish/weibo-sdk/browser` 子路径，axios 与 zod 一起打包 |

`weibo-cli` 启动时自检 Node 版本，低于 20.16 时直接输出下面这行并以非零码退出：

```text
weibo-cli requires Node >= 20.16 (current: v18.x.x).
```

## bun 与容器环境

bun 全局安装后直接运行 `weibo-cli --version`。一次性调用用 `bunx -p @chilfish/weibo-sdk weibo-cli --version`。

`bunx weibo-cli` 从当前项目的 `node_modules/.bin` 查找可执行文件。该写法要求项目已安装本包。

Termux / proot 使用 `link2symlink`。bun 1.4 在该环境把安装缓存写成 `.l2s.<name>NNNN` 备份文件。安装退出码是 0。加载包时报 `ENOENT` 或 `ERR_UNKNOWN_FILE_EXTENSION`。修复步骤：

```bash
rm -rf ~/.bun/install/cache
bun add -g --backend=copyfile @chilfish/weibo-sdk
```

缓存已污染时，`--backend=copyfile` 会原样复制缓存里的软链。先清缓存，再安装。

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
