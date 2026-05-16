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
  },
})
