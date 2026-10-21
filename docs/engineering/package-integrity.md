# 包完整性与下游打包指南

> **目标**：下游在 Node、Vite/Webpack/Rollup/esbuild、用户脚本、TypeScript 等场景安装 `@chilfish/weibo-sdk` 后，模块解析、类型、tree-shaking、运行时行为都符合预期。
> **状态**：本文是现状审计 + 目标契约 + 门禁方案；标注「规划」的措施尚未实施。
> **相关**：[插件化与传输适配调研](../planning/research-plugin-architecture-2026-10-21.md) / [Release Checklist](./release-checklist.md)。

---

## 0. 结论先行（TL;DR）

1. 包保持 **ESM-only**，不新增 CJS 构建。CJS 调用方使用动态 `import()`。
2. 根入口 `exports` 补 `types` 条件；`./cli` 明确类型策略；新增 schema 子路径（如果决定随包发布）。
3. `sideEffects: false` 与 `src/cli.ts` 顶层 `runMain()` 不一致：改为精确 allowlist，或拆分命令树与 bin 入口。推荐拆分。
4. 补 `engines.node`。`process.getBuiltinModule` 需要 Node 20.16+ / 22.3+，当前文档写 Node 18+ 不准确。
5. 公开 `.d.mts` 不得引用 `axios` / `zod` 类型；公共契约继续使用 `z.infer` 的输出。
6. `./browser` 保持自包含（用户脚本 / 无打包器）；SPA 走根入口，由宿主 bundler 去重依赖。
7. 发布门禁从「读 package.json 字段」升级为「真实 tarball 核验」：`pnpm pack` → `publint` → `attw` → 临时安装 → Node import → `tsc` → Vite/esbuild → tree-shaking 断言。

---

## 1. 当前发布形态

| 字段 | 当前值 | 观察 |
|---|---|---|
| `name` | `@chilfish/weibo-sdk` | scoped 包，`publishConfig.access = public` |
| `type` | `module` | ESM-only |
| `exports["."]` | `./dist/index.mjs` | 裸字符串，**没有 `types` 条件** |
| `exports["./cli"]` | `./dist/cli.mjs`（tsdown 生成） | 无显式 `types`；入口有顶层副作用 |
| `exports["./browser"]` | `{ types: ./dist/index.d.mts, default: ./dist/browser.mjs }` | 自包含 ESM；类型复用 node 入口 |
| `exports["./package.json"]` | `./package.json` | 正常 |
| `types` | `./dist/index.d.mts` | 顶层兜底；`node16` / `bundler` 解析依赖 `exports` 条件 |
| `bin` | `weibo-cli → ./dist/cli.mjs` | CLI 入口 |
| `sideEffects` | `false` | 与 `dist/cli.mjs` 顶层 `runMain()` 不一致 |
| `files` | `["dist"]` | **`schemas/` 不会随包发布** |
| `engines` | 缺失 | 无 Node 版本约束 |
| dependencies | `axios` / `citty` / `zod` | node 构建 external；browser 构建内联 axios + zod |
| 构建 | `tsdown` node + browser 两个 target | browser 复用 node 的 d.ts |

---

## 2. 下游消费矩阵

| 消费方式 | 典型代码 | 应解析到 | 当前风险 | 目标 |
|---|---|---|---|---|
| Node ESM | `import { WeiboSDK } from '@chilfish/weibo-sdk'` | `dist/index.mjs` | `axios` 需在 Node 可用；无 `engines` | 保持；补 `engines` |
| Node CJS | `require('@chilfish/weibo-sdk')` | 不支持 | 直接 `ERR_REQUIRE_ESM` | 明确 ESM-only；文档给 `await import()` |
| TS（bundler / node16） | `import type { ITweet }` | `dist/index.d.mts` | 根入口无 `types` 条件，部分解析模式可能退化 | 加 `types` 条件并用 `attw` 验证 |
| Vite SPA | `import { WeiboSDK } from '@chilfish/weibo-sdk'` | `dist/index.mjs`，axios 由 Vite 打包 | axios CJS/ESM interop；Node-only 代码必须动态访问 | 保持；用 Vite 产物验证 |
| 用户脚本 / 无打包器 | `import { WeiboSDK } from '@chilfish/weibo-sdk/browser'` | `dist/browser.mjs`（内联 axios + zod） | 与宿主自带 zod 可能重复 | 保持自包含；文档说明重复风险 |
| CLI | `weibo-cli ...` / `node dist/cli.mjs` | `dist/cli.mjs` | `sideEffects: false` 不准确 | 拆分或 allowlist |
| 归档 schema 消费者 | 读取 `$schema` / 本地文件 | **包内没有 `schemas/`** | 只能依赖 GitHub raw `main` | 随包发布并加子路径，或明确不承诺 |
| 测试替身 | `new WeiboSDK({ transport })`（规划） | 自定义 transport | 当前只能注入 axios 实例 | Phase 1 后无需 axios |

---

## 3. 风险清单

### R1. `exports["."]` 缺少 `types` 条件（中）

`package.json` 有顶层 `types`，但 `exports["."]` 是裸字符串。TypeScript 的 `node16` / `nodenext` / `bundler` 优先读 `exports` 条件；缺少 `types` 时行为依赖 TS 版本的兜底逻辑，`attw` 会把这类包标为类型解析问题。

**修复**：改为条件对象，`types` 放在第一项。

### R2. `sideEffects: false` 与 CLI 顶层副作用冲突（中）

`src/cli.ts` 末尾直接执行 `runMain(withErrorEnvelope(main))`。bin 执行不受影响，但如果下游 `import '@chilfish/weibo-sdk/cli'`，bundler 可能认为该模块无副作用而删除它。

**修复（推荐）**：拆分 `src/cli.ts` 为命令树导出 + `src/cli-bin.ts` 执行 `runMain()`；`bin` 指向后者。否则至少设置 `"sideEffects": ["./dist/cli.mjs"]`。

### R3. 没有 `engines`，Node 版本要求写错（中）

`src/utils/cookieInput.ts` 通过 `process.getBuiltinModule('node:fs')` 读取 Cookie 文件。该 API 在 Node 20.16 / 22.3 才引入；在更旧版本上会退化为「只接受 header 串」，文件路径静默失效。当前文档却写 Node 18+。

**修复**：`package.json` 增加 `"engines": { "node": ">=22" }`（或 `>=20.16`），README / AGENTS 同步；如果确实要支持 Node 18，改为静态 `import('node:fs')` 的动态兜底。

### R4. browser 入口内联 axios + zod（中）

`tsdown.config.ts` 的 browser target 使用 `alwaysBundle: ['axios', 'zod']`。好处是用户脚本 / 无打包器可直接 import；代价是 SPA 若同时使用 zod，会出现两份 zod。SDK 内部不依赖 zod 的 `instanceof` 跨副本语义（错误里只保留 issues），所以运行时风险低，主要是体积。

**修复**：保持 `./browser` 自包含；文档明确「SPA 用根入口，用户脚本用 `./browser`」。是否给根入口加 `browser` 条件，等 `FetchTransport` 落地后用真实产物测量再决定。

### R5. ESM-only（低，但需明确）

没有 CJS 构建。`require()` 会失败。这是有意的取舍：双包会带来双份类型、双份状态与 dual-package hazard。

**修复**：README / CHANGELOG 明确 ESM-only；给 CJS 用户一行 `const { WeiboSDK } = await import('@chilfish/weibo-sdk')`。

### R6. 公开类型泄漏 axios / zod（低，需持续守卫）

`src/types/index.ts` 导出的是 `z.infer` 的结果类型和业务接口，不导出 schema 本身；`IWeiboConfig` 也没有 axios 类型。但这是当前事实，不是机制保证。未来把 `EndpointSpec` 或 `ZodType` 暴露到公共入口，就会把 zod 类型带进下游。

**修复**：加一条发布检查：`dist/*.d.mts` 中不得出现 `from "axios"` / `from "zod"` / `import("axios")`。公开 `EndpointSpec` 若要做，必须用 `import type` 且评估类型兼容。

### R7. tree-shaking 依赖 `sideEffects` 与入口纯度（中）

根入口 `export *` 了 capabilities、models、types、utils、WeiboSDK。`sideEffects: false` 让 bundler 可以删除未使用导出，但前提是模块顶层没有副作用。当前 `src/index.ts` 只做 re-export 与读 `package.json` 的 `VERSION`，没有 IO / console；后续插件、transport、logger 的注册必须显式发生，不能在模块加载时自动注册。

**修复**：加 esbuild metafile 断言：只 import `WeiboSDK` 时，CLI 命令、媒体下载器、归档服务等未使用模块不应进入产物（或至少 CLI 不进）。

### R8. `catalog:` 协议（已缓解）

`npm publish` 不会重写 pnpm `catalog:`，产物会写成 `"axios": "catalog:"`。已有 `scripts/verify-publish-tool.mjs` 在 `prepublishOnly` 阶段阻止 npm 发布，并有 postmortem 010。

**修复**：保持；发布核验继续用 `pnpm pack`，不要用 `npm pack` 检查依赖。

### R9. 导出测试太浅（中）

`tests/unit/entry/exports.test.ts` 只断言字段形状与 `sideEffects === false`，不验证真实 tarball、条件解析、类型解析、打包结果。

**修复**：保留现有单测作为快速回归；新增 `verify:package` / `lint:package` / `test:bundle` 三个脚本，见 §5。

### R10. `schemas/` 不随包发布（中）

`files: ["dist"]` 意味着 `schemas/weibo-user-archive/v1.json` 不在 tarball 里。归档文件的 `$schema` 指向 GitHub raw `main`，是可变分支，不是版本化产物。

**修复（二选一）**：

- 随包发布 `schemas/`，加 `exports["./schemas/weibo-user-archive/v1.json"]`，`$schema` 可用 `https://unpkg.com/@chilfish/weibo-sdk@<version>/schemas/...`。
- 明确不随包发布，但把 `$schema` 改为 tag / release 固定 URL（如 `.../v0.3.0/schemas/...`），并写入文档。

### R11. `citty` 对所有用户都是 dependency（低）

只用 SDK 的下游也会安装 `citty`。npm 磁盘成本小，且 CLI 与 SDK 同包；拆包会带来版本同步成本。

**修复**：本轮不拆；如果未来 CLI 依赖继续增长，再评估独立包或 optional dependency。

### R12. 插件 API 可能破坏 tree-shaking（未来，需约束）

如果插件作者用「import 即注册」的写法（模块顶层调用 `registerPlugin()`），bundler 无法安全删除，`sideEffects: false` 会变成谎言。

**修复**：插件必须以值 / 函数形式显式传给 `new WeiboSDK({ plugins: [...] })`；禁止模块级自动注册；文档与 ESLint 规则约束。

---

## 4. 目标包契约

### 4.1 `package.json` 目标形态

```jsonc
{
  "type": "module",
  "engines": { "node": ">=22" },
  "sideEffects": false,
  "files": ["dist", "schemas"],
  "exports": {
    ".": {
      "types": "./dist/index.d.mts",
      "default": "./dist/index.mjs"
    },
    "./browser": {
      "types": "./dist/index.d.mts",
      "default": "./dist/browser.mjs"
    },
    "./cli": {
      "types": "./dist/cli.d.mts",
      "default": "./dist/cli.mjs"
    },
    "./schemas/weibo-user-archive/v1.json": "./schemas/weibo-user-archive/v1.json",
    "./package.json": "./package.json"
  }
}
```

说明：

- **ESM-only**：不提供 `require` 条件。
- **`types` 条件放在首位**，其余用 `default`。
- **`./cli`**：如果拆分命令树与 bin 入口，`./cli` 指向纯命令树；`bin` 指向 `dist/cli-bin.mjs`。如果暂不拆分，则 `sideEffects` 改为 `["./dist/cli.mjs"]`。
- **schema 子路径**：是否随包发布见 R10；若发布，`files` 加 `schemas` 并登记子路径。
- **`engines`**：至少 `>=20.16`，推荐 `>=22`；与 `process.getBuiltinModule` 对齐。

### 4.2 入口纯度

- 库入口（`src/index.ts`、`src/services/**`、`src/models/**`、`src/utils/**`）**禁止顶层副作用**：不读写文件、不发请求、不 `console`、不注册全局 handler。
- CLI 执行与命令树分离；bin 入口是唯一允许顶层副作用的模块，且不被 `exports` 暴露。
- 插件通过 `plugins` 数组显式传入；禁止 import 即注册。
- `VERSION` 读取 `package.json` 的方式必须被 tsdown 内联或可被所有目标 bundler 解析；发布检查扫描 `dist/*.mjs` 是否残留相对 `package.json` 导入。

### 4.3 公共类型纯度

- `dist/*.d.mts` 不得出现 `from "axios"` / `from "zod"` / `import("axios")` / `import("zod")`。
- 如果未来公开 `EndpointSpec` 或 schema，必须单独 ADR，并接受 zod 版本兼容成本。
- 新增公共导出时同步更新：
  - `tests/unit/entry/exports.test.ts` 的导出面断言；
  - `attw` 结果；
  - `docs/README.md` / `technical-spec.md` 的契约章节。

### 4.4 依赖策略

| 依赖 | 现状 | 目标 |
|---|---|---|
| `axios` | node external / browser inline | Phase 1 后由 `AxiosTransport` 封装；是否降为 optional peer 另议 |
| `zod` | node external / browser inline | 保持 dependency；公共类型不泄漏 |
| `citty` | dependency，仅 CLI 使用 | 本轮不拆；后续若 CLI 增长再评估独立包 |
| 新增运行时依赖 | — | 先评估 tree-shaking / bundle / Edge 兼容；能内联的小依赖优先内联 |

---

## 5. 产物核验矩阵

> 目标：不是「package.json 字段看起来对」，而是「真实 tarball 在真实消费者工程里能解析、能类型检查、能打包、能运行」。

### 5.1 构建与打包

```bash
pnpm run build
pnpm pack --pack-destination .tmp-pack
```

检查：

- tarball 只包含 `dist/`、`schemas/`（若启用）、`README.md`、`LICENSE.md`、`package.json`。
- tarball 的 `dependencies` 已由 pnpm 重写，没有 `catalog:` / `workspace:`。
- `dist/index.mjs`、`dist/index.d.mts`、`dist/browser.mjs`、`dist/cli.mjs`（或拆分后的两个文件）都存在。

### 5.2 包规范与类型解析

```bash
# 本地包目录（读取 package.json 与 files/exports）
npx publint

# 安装后的真实包目录（推荐，覆盖 tarball 解包结果）
npx publint .tmp-consumer/node_modules/@chilfish/weibo-sdk

# 类型解析：attw 会自行 pack 当前包
npx @arethetypeswrong/cli --pack .
```

通过标准：

- `publint` 无 error（warning 逐条确认）。
- `attw` 的 `node16` / `bundler` 两种解析模式下，`.` / `./browser` / `./cli` 均为绿色；不得出现「No types」「Masquerading as CJS」「False ESM」。
- ESM-only 是预期；`attw` 对 CJS 的提示需在文档中说明为已知取舍。

### 5.3 真实安装与运行时

在临时目录创建消费者工程：

```bash
mkdir .tmp-consumer && cd .tmp-consumer
npm init -y
npm i ../.tmp-pack/chilfish-weibo-sdk-<version>.tgz
```

检查：

- `node --input-type=module -e "import('@chilfish/weibo-sdk').then(m => console.log(typeof m.WeiboSDK))"` 输出 `function`。
- `node node_modules/@chilfish/weibo-sdk/dist/cli.mjs --version` 输出正确版本。
- `require('@chilfish/weibo-sdk')` 以 `ERR_REQUIRE_ESM` 失败（预期行为，写入文档）。
- 如果发布 schema：`require.resolve('@chilfish/weibo-sdk/schemas/weibo-user-archive/v1.json')` 可解析，Ajv 能加载。
- `npm ls axios zod citty` 无重复版本 / 无缺失。

### 5.4 TypeScript 消费者

准备两份最小消费者类型检查：

| tsconfig | 关键配置 | 验证点 |
|---|---|---|
| bundler | `module: ESNext` / `moduleResolution: Bundler` / `strict: true` | 根入口与子路径类型可解析；`ITweet` / `WeiboSDK` 可用 |
| node16 | `module: Node16` / `moduleResolution: Node16` / `strict: true` | `exports` 条件与 `.d.mts` 正确；无 CJS 误判 |

断言：`tsc --noEmit` 通过，且不要求消费者安装 `axios` / `zod` 的类型包（它们是 dependency，但公共类型不应直接依赖）。

### 5.5 Vite / SPA

最小 Vite 工程：

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'
console.log(typeof WeiboSDK)
```

断言：

- `vite build` 成功。
- 产物不含 `node:fs` / `node:path` 等 Node builtin。
- 产物中 `zod` 只有一份（若宿主不使用 zod，则由 SDK 的依赖引入一份）。
- 如果使用 `@chilfish/weibo-sdk/browser`，产物无 bare import，能直接在无打包器环境运行。

### 5.6 esbuild + tree-shaking

```bash
npx esbuild src/main.ts --bundle --platform=browser --format=esm \
  --tree-shaking=true --metafile=meta.json --outfile=out.mjs
```

只 import `WeiboSDK`，断言：

- `meta.inputs` 不包含 `dist/cli.mjs` / `dist/cli-bin.mjs`。
- 不包含 `src/services/public/ArchiveService` 等未使用服务（或至少不包含 CLI / 媒体下载器）。
- 包体大小不超过基线阈值（基线在首次测量后写入脚本）。
- 产物中不出现 `process.getBuiltinModule` 的静态调用路径（若出现，确认是死代码且可被删除）。

### 5.7 Worker / Edge smoke

用 `node:worker_threads` 启动一个 worker：

```js
import { WeiboSDK } from '@chilfish/weibo-sdk'
import { fetchTransport } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({ transport: fetchTransport({ fetch: fakeFetch }) })
// 断言构造成功、可发起一次 fake 请求
```

断言：

- worker 中无 `window` / `document` 也能构造与请求。
- `cookieInput` 的 `process.getBuiltinModule` 分支在 worker 下不抛错。
- 自定义 transport 不依赖 axios。

### 5.8 发布后 registry 核验

- `npm view @chilfish/weibo-sdk@<version> dist.tarball` 下载后重复 §5.1–5.5 的关键检查。
- `npm audit signatures` 通过。
- `@chilfish/weibo-sdk@<version>` 的 `exports` / `types` / `engines` 与本地 tarball 一致。

---

## 6. CI 门禁

新增三个独立脚本，避免把慢检查塞进单测：

| 脚本 | 内容 | 何时跑 |
|---|---|---|
| `pnpm run lint:package` | `publint` + `attw --pack` | 每个 PR（Node 22） |
| `pnpm run verify:package` | `pnpm pack` + 临时安装 + Node import + CLI 版本 + schema 解析 | 每个 PR（Node 22） |
| `pnpm run test:bundle` | Vite + esbuild + tree-shaking + Worker smoke | 每个 PR（Node 22）；发布前再跑 |

CI 约束：

- 三个脚本都在 `build` 之后执行，复用同一份 `dist/`。
- 失败时上传 tarball 与 metafile 作为 artifact，便于定位。
- `publish.yml` 在发布前复跑三个脚本；不允许跳过。
- Node 矩阵至少覆盖 22 / 24；`engines` 声明与矩阵一致。

---

## 7. 编码规则（面向后续改动）

1. **新子路径**：必须同时提供 `types` 与 `default`，并在 `exports.test.ts` + `attw` 中登记。
2. **公共类型**：只用 `z.infer` 的输出与业务接口；禁止直接导出 `ZodType` / `AxiosInstance`。
3. **入口纯度**：库入口禁止顶层 IO / console / 全局注册；CLI 执行单独入口。
4. **不新增 CJS**：需要 CJS 的消费者用动态 `import()`。
5. **browser 入口**：不得静态 import `node:*`；Node-only 能力通过 `process.getBuiltinModule` 或动态 `import()` 按需取用。
6. **插件注册**：显式传入 `plugins` 数组；禁止模块加载时自动注册；插件包也必须 `sideEffects: false` 安全。
7. **新增运行时依赖**：先评估 bundle 体积、Edge / Worker 兼容、tree-shaking；不要把仅 CLI 使用的依赖带进根入口。
8. **导出面变更**：同步更新 `exports.test.ts`、`docs/README.md`、`technical-spec.md`、`CHANGELOG.md`。
9. **schema / 静态资源**：如果下游需要本地文件，必须进 `files` + `exports`，不能只依赖 GitHub raw。

---

## 8. 发布 Checklist 追加项

以下为规划项，落地后勾选并记录日期：

- [ ] `pnpm run lint:package` 通过（`publint` + `attw`）
- [ ] `pnpm run verify:package` 通过（tarball 安装 + Node import + CLI 版本）
- [ ] `pnpm run test:bundle` 通过（Vite + esbuild + tree-shaking + Worker）
- [ ] `dist/*.d.mts` 无 `axios` / `zod` 类型引用
- [ ] `dist/*.mjs` 无未处理的 Node-only 静态导入
- [ ] `engines.node` 与 CI 矩阵一致
- [ ] 如发布 schema：tarball 内 `schemas/` 与子路径可解析
- [ ] 发布后从 registry 下载 tarball 复跑关键检查

---

## 9. 参考资料

- [Node.js Package `exports`](https://nodejs.org/api/packages.html#package-entry-points)
- [TypeScript `moduleResolution`](https://www.typescriptlang.org/tsconfig#moduleResolution)
- [publint](https://publint.dev/)
- [Are the types wrong?](https://arethetypeswrong.github.io/)
- [tsdown](https://tsdown.dev/)
- [插件化与传输适配调研](../planning/research-plugin-architecture-2026-10-21.md)
- [Release Checklist](./release-checklist.md)

