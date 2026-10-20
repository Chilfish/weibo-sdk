#!/usr/bin/env node
/**
 * 发布前校验：tag 必须与 package.json 版本一致，且 CHANGELOG 有对应版本节。
 *
 * 用法：node scripts/verify-release-tag.mjs <tag>（例如 v0.3.0）
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

const tag = process.argv[2]
if (!tag) {
  process.stderr.write('用法：node scripts/verify-release-tag.mjs <tag>\n')
  process.exit(1)
}

const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version
const tagVersion = tag.startsWith('v') ? tag.slice(1) : tag

if (tagVersion !== version) {
  process.stderr.write(`✖ tag ${tag} 与 package.json 版本 ${version} 不一致\n`)
  process.exit(1)
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
if (!changelog.includes(`## ${version} (`)) {
  process.stderr.write(`✖ CHANGELOG.md 缺少 ${version} 的版本节\n`)
  process.exit(1)
}

process.stdout.write(`✔ release ${tag} ↔ package.json ${version}\n`)
