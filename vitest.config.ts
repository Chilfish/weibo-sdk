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
  },
})
