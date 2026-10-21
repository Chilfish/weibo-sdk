#!/usr/bin/env node
/**
 * 包规范 / 类型解析门禁（PF5）。
 *
 * 依次运行 `publint` 与 `@arethetypeswrong/cli`，两者都通过 `pnpm dlx` 临时下载，
 * 不新增依赖。工具下载或执行失败一律按硬错误处理：这是发布门禁，不做静默跳过。
 *
 * 用法：pnpm run lint:package（需先 pnpm build 生成 dist/）
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED_DIST = [
  'dist/index.mjs',
  'dist/index.d.mts',
  'dist/cli.mjs',
  'dist/cli.d.mts',
  'dist/cli-bin.mjs',
  'dist/browser.mjs',
]

const CHECKS = [
  { label: 'publint', command: 'pnpm dlx publint' },
  // ESM-only（R5：不提供 CJS 构建）：--profile esm-only 让 attw 跳过 node10 / CJS 解析，
  // 只对 node16-from-ESM 与 bundler 两种模式求绿，与 §5.2 的通过标准一致。
  { label: 'attw', command: 'pnpm dlx @arethetypeswrong/cli --pack . --profile esm-only' },
]

function log(message) {
  process.stdout.write(`${message}\n`)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

function main() {
  const missing = REQUIRED_DIST.filter(file => !existsSync(path.join(ROOT, file)))
  if (missing.length > 0) {
    fail(`✖ 缺少构建产物：${missing.join(', ')}；先执行 \`pnpm build\``)
    return
  }

  const failed = []

  for (const { label, command } of CHECKS) {
    log(`\n▸ ${label}: ${command}`)

    const result = spawnSync(command, {
      cwd: ROOT,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, CI: '1', npm_config_yes: 'true' },
    })

    if (result.error) {
      fail(`✖ ${label} 无法启动（${result.error.code ?? result.error.message}）`)
      fail(`  \`pnpm dlx\` 首次运行需要联网下载 ${label}；工具不可用视为门禁失败，不跳过。`)
      failed.push(label)
      continue
    }

    if (result.status !== 0) {
      fail(`✖ ${label} 报告问题（exit ${result.status ?? `signal ${result.signal}`}）；详见上方输出`)
      failed.push(label)
      continue
    }

    log(`✔ ${label} 通过`)
  }

  if (failed.length > 0) {
    fail(`\n✖ lint:package 失败：${failed.join(', ')}`)
    return
  }

  log('\n✔ lint:package 全部通过')
}

main()
