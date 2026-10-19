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
    // E2E 显式开关：默认 pnpm test 不会设置 WEIBO_E2E，仅此入口激活
    env: { WEIBO_E2E: '1' },
    server: {
      deps: {
        inline: ['vitest-package-exports'],
      },
    },
    globals: true,
    include: ['tests/e2e/**/*.test.ts'],
    setupFiles: ['tests/e2e/setup-env.ts'],
  },
})
