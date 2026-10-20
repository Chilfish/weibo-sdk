#!/usr/bin/env node
/**
 * CHANGELOG.md 版本节工具。
 *
 * - 无参数：把 `## Unreleased` 转成 `## <package.json version> (<date>)`，并保留一个新的
 *   `## Unreleased` 空节。由 `bumpp --execute` 在版本号更新之后调用。
 * - `--extract <version>`：输出版本节正文，供手写 GitHub Release notes 时导出底稿。
 *
 * 约定：每次发布前必须先在 Unreleased 写全本版变化，空节会直接失败。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

const CHANGELOG_URL = new URL('../CHANGELOG.md', import.meta.url)
const PACKAGE_URL = new URL('../package.json', import.meta.url)

function readVersion() {
  return JSON.parse(readFileSync(PACKAGE_URL, 'utf8')).version
}

function localDate() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function extractSection(markdown, headingPrefix) {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => line.startsWith(headingPrefix))
  if (start === -1)
    return null

  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim()
}

function finalize() {
  const version = readVersion()
  const markdown = readFileSync(CHANGELOG_URL, 'utf8')

  if (markdown.includes(`## ${version} (`)) {
    process.stdout.write(`CHANGELOG 已包含 ${version} 版本节，跳过\n`)
    return
  }

  if (!extractSection(markdown, '## Unreleased'))
    throw new Error('CHANGELOG.md 的 ## Unreleased 节为空，先写入本版变化')

  const updated = markdown.replace(
    /^## Unreleased$/m,
    `## Unreleased\n\n## ${version} (${localDate()})`,
  )
  writeFileSync(CHANGELOG_URL, updated)
  process.stdout.write(`CHANGELOG: Unreleased → ${version}\n`)
}

function printSection(version) {
  const section = extractSection(
    readFileSync(CHANGELOG_URL, 'utf8'),
    `## ${version} `,
  )
  if (!section)
    throw new Error(`CHANGELOG.md 缺少 ${version} 的版本节`)

  process.stdout.write(`${section}\n`)
}

const [mode, value] = process.argv.slice(2)

try {
  if (mode === '--extract') {
    if (!value)
      throw new Error('用法：node scripts/changelog.mjs --extract <version>')
    printSection(value)
  }
  else if (mode) {
    throw new Error('用法：node scripts/changelog.mjs [--extract <version>]')
  }
  else {
    finalize()
  }
}
catch (error) {
  process.stderr.write(`✖ ${error.message}\n`)
  process.exit(1)
}
