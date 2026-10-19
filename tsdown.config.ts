import { defineConfig } from 'tsdown'

/**
 * 两个构建目标：
 *
 * 1. `node`：库入口 + CLI（`dist/index.mjs` / `dist/cli.mjs`），保持 Node 平台语义，
 *    依赖（axios/zod）保持 external，由包管理器解析。
 * 2. `browser`：浏览器安全入口（`dist/browser.mjs`），平台切到 `browser`，
 *    并把 axios/zod 内联进产物，使 web-v3（Vite SPA）与 monkey（userscript）
 *    在无打包器/受限环境下也能直接以 ESM 方式引入，不会触发 Node-only 模块解析。
 */
export default defineConfig([
  {
    name: 'node',
    entry: ['src/index.ts', 'src/cli.ts'],
    format: 'esm',
    dts: true,
    clean: true,
    platform: 'node',
    target: 'esnext',
    nodeProtocol: 'strip',
    exports: {
      // 浏览器入口不是 node 构建的 chunk，这里显式声明其子路径导出。
      customExports: {
        './browser': {
          // 与 "." 完全相同的 API，复用 node 构建产出的类型声明。
          types: './dist/index.d.mts',
          default: './dist/browser.mjs',
        },
      },
    },
  },
  {
    name: 'browser',
    entry: { browser: 'src/index.ts' },
    format: 'esm',
    // 类型复用 node 构建的 index.d.mts：内联 axios/zod 时 dts 打包会因 CJS 类型声明失败，
    // 而两个入口的公开 API 完全相同，无需重复生成。
    dts: false,
    clean: false,
    platform: 'browser',
    target: 'esnext',
    nodeProtocol: 'preserve',
    // browser 平台默认输出 .js；统一用 .mjs 与 node 构建保持一致。
    outExtensions: () => ({ js: '.mjs' }),
    // 自包含产物：浏览器/用户脚本场景可直接 import，无需额外解析 bare specifier。
    deps: {
      alwaysBundle: ['axios', 'zod'],
      onlyBundle: ['axios', 'zod'],
    },
    // node 构建负责生成 package.json#exports，避免两个构建互相覆盖。
    exports: false,
  },
])
