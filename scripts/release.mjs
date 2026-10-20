#!/usr/bin/env node
/**
 * 一键发版：校验仓库状态 → 跑本地门禁 → bump 版本 / 转 CHANGELOG / commit / tag / push。
 *
 * 用法：pnpm release <patch|minor|major|x.y.z> [--skip-checks] [--dry-run]
 *
 * tag 推送后由 .github/workflows/publish.yml 负责发布 npm 与创建 GitHub Release，
 * 本地不再执行 `pnpm publish`。
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'
import { x } from 'tinyexec'

const PACKAGE_URL = new URL('../package.json', import.meta.url)
const USAGE = '用法：pnpm release <patch|minor|major|x.y.z> [--skip-checks] [--dry-run]'

function fail(message) {
  process.stderr.write(`✖ ${message}\n`)
  process.exit(1)
}

function info(message) {
  process.stdout.write(`${message}\n`)
}

async function run(command, args) {
  info(`▸ ${command} ${args.join(' ')}`)
  await x(command, args, {
    throwOnError: true,
    nodeOptions: { stdio: 'inherit' },
  })
}

function capture(command, args) {
  return x(command, args, { throwOnError: false })
}

function bumpVersion(current, release) {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i.test(release))
    return release

  const [major, minor, patch] = current.split('-')[0].split('.').map(Number)

  switch (release) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    default:
      fail(`无法识别的版本类型：${release}\n${USAGE}`)
  }
}

const argv = process.argv.slice(2)
const release = argv.find(arg => !arg.startsWith('--'))
const skipChecks = argv.includes('--skip-checks')
const dryRun = argv.includes('--dry-run')

if (!release)
  fail(USAGE)

const currentVersion = JSON.parse(readFileSync(PACKAGE_URL, 'utf8')).version
const nextVersion = bumpVersion(currentVersion, release)
const tag = `v${nextVersion}`

info(`▸ ${currentVersion} → ${nextVersion}`)

const branch = (await capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
if (branch !== 'main')
  fail(`必须在 main 上发布，当前分支：${branch}`)

const dirty = (await capture('git', ['status', '--porcelain'])).stdout.trim()
if (dirty)
  fail('工作区不干净，先提交或清理改动')

await run('git', ['fetch', 'origin', 'main', '--quiet'])

const head = (await capture('git', ['rev-parse', 'HEAD'])).stdout.trim()
const remoteHead = (await capture('git', ['rev-parse', 'origin/main'])).stdout.trim()
if (head !== remoteHead)
  fail('本地 main 与 origin/main 不一致，先 push / pull 再发布')

const localTag = await capture('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])
if (localTag.exitCode === 0)
  fail(`tag ${tag} 已存在`)

const remoteTag = await capture('git', ['ls-remote', '--tags', 'origin', tag])
if (remoteTag.stdout.trim())
  fail(`远端 tag ${tag} 已存在`)

const published = await capture('npm', ['view', `@chilfish/weibo-sdk@${nextVersion}`, 'version'])
if (published.exitCode === 0 && published.stdout.trim())
  fail(`npm 上已存在 @chilfish/weibo-sdk@${nextVersion}`)

if (dryRun) {
  info(`▸ dry-run：将发布 ${tag}（未执行门禁与 git 操作）`)
  process.exit(0)
}

if (!skipChecks) {
  await run('pnpm', ['run', 'typecheck'])
  await run('pnpm', ['exec', 'eslint', '.'])
  await run('pnpm', ['test', '--run'])
  await run('pnpm', ['run', 'validate:fixtures'])
  await run('pnpm', ['run', 'build'])
}

await run('pnpm', [
  'exec',
  'bumpp',
  '--release',
  nextVersion,
  '--commit',
  'chore(release): v{version}',
  '--tag',
  '--all',
  '--yes',
  '--git-check',
  '--execute',
  'node scripts/changelog.mjs',
])

info(`✔ 已推送 ${tag}，发布由 GitHub Actions（publish.yml）继续`)
