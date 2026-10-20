#!/usr/bin/env node
/**
 * 发布工具守卫：只允许 `pnpm publish`。
 *
 * npm publish 不识别 pnpm 的 `catalog:` 协议，会把 `"axios": "catalog:"` 原样写进产物
 * package.json，消费者安装时报 EUNSUPPORTEDPROTOCOL（见 postmortem 010）。
 * `pnpm publish` / `pnpm pack` 会把 catalog 重写为具体版本。
 */

const userAgent = process.env.npm_config_user_agent || ''

if (!userAgent.startsWith('pnpm/')) {
  process.stderr.write('✖ 请使用 `pnpm publish` 发布：npm publish 会把 catalog: 依赖原样打进产物，消费者无法安装。\n')
  process.stderr.write(`  当前 npm_config_user_agent = ${JSON.stringify(userAgent)}\n`)
  process.exit(1)
}
