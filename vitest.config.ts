import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src'),
      'tests': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tests'),
    },
  },
  test: {
    server: {
      deps: {
        inline: ['vitest-package-exports'],
      },
    },
    globals: true,
    // 默认 `pnpm test` 必须离线稳定：E2E 仅在专门入口中运行
    include: ['tests/**/*.test.ts'],
    // exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/cli-bin.ts'],
      reportsDirectory: './coverage',
      // 阈值是「棘轮」：只允许上调，不允许下调。
      // 基线取自实测值向下取整 1~2 个点（见 coverage/coverage-summary.json）。
      // 新增测试把覆盖率拉高后，请同步把这里的阈值往上抬，永远不要为了过 CI 而降低。
      thresholds: {
        lines: 82,
        statements: 82,
        functions: 81,
        branches: 73,
      },
    },
  },
})
