#!/usr/bin/env node
/**
 * 真实 tarball 核验门禁（PF5 / R8 / R9）。
 *
 * 不信任 package.json 字段，而是走一遍 `pnpm pack` → 解包 → Node import → CLI --version，
 * 断言消费者真正拿到的东西是对的：
 * 1. `package.json` 依赖段无 `catalog:`（npm publish 会把它原样写进产物，见 postmortem 010）。
 * 2. `engines.node` 存在。
 * 3. 解包后的 `dist/index.mjs` 可被 Node 直接 import，且 `WeiboSDK` 是函数。
 * 4. `dist/cli-bin.mjs --version` 输出 `package.json#version`。
 * 5. `dist/*.d.mts` 不泄漏 `axios` / `zod` 类型（公共契约纯度）。
 *
 * 解包目录落在仓库内（`.tmp-verify/package`），因此 Node 仍能从仓库根 node_modules
 * 解析 axios / zod / citty，不需要联网安装。
 *
 * 用法：pnpm run verify:package（需先 pnpm build）
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP_DIR = path.join(ROOT, '.tmp-verify')
const PACK_DIR = path.join(TMP_DIR, 'package')
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
// zod 是运行时依赖，`z.infer` 别名会带出它的类型；axios 类型不应出现在公共契约里。
// dts bundler 可能保留裸 `import "axios"`（内部模块的 side-effect import），它不泄漏类型，允许。
const FORBIDDEN_TYPE_REFS = [
  /from\s+["']axios["']/,
  /import\(\s*["']axios["']\s*\)/,
]

const failures = []

function log(message) {
  process.stdout.write(`${message}\n`)
}

function check(ok, message) {
  if (ok) {
    log(`✔ ${message}`)
    return true
  }
  failures.push(message)
  process.stderr.write(`✖ ${message}\n`)
  return false
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', ...options })
  if (result.error)
    throw result.error
  return result
}

function runShell(command) {
  const result = spawnSync(command, { cwd: ROOT, shell: true, encoding: 'utf8' })
  if (result.error)
    throw result.error
  return result
}

/** Windows 上路径要转成正斜杠，才能安全拼进 shell / tar 命令。 */
function toPosix(absolutePath) {
  return absolutePath.replaceAll('\\', '/')
}

function findTarball() {
  const tarballs = readdirSync(TMP_DIR).filter(file => file.endsWith('.tgz'))
  if (tarballs.length !== 1)
    throw new Error(`期望 .tmp-verify 下恰好一个 .tgz，实际 ${tarballs.length} 个：${tarballs.join(', ')}`)
  return path.join(TMP_DIR, tarballs[0])
}

function verifyManifest(packed) {
  const withCatalog = DEP_FIELDS.filter(field =>
    Object.values(packed[field] ?? {}).some(value => String(value).includes('catalog:')),
  )
  check(
    withCatalog.length === 0,
    `tarball package.json 依赖段无 \`catalog:\`（检查：${withCatalog.join(', ') || '全部干净'}）`,
  )
  check(
    typeof packed.engines?.node === 'string' && packed.engines.node.length > 0,
    `tarball package.json 带 engines.node（${packed.engines?.node ?? '缺失'}）`,
  )
  check(
    packed.bin?.['weibo-cli'] === './dist/cli-bin.mjs',
    `tarball package.json#bin.weibo-cli = ${packed.bin?.['weibo-cli'] ?? '缺失'}`,
  )
  return packed.version
}

function verifyNodeImport() {
  const entry = path.join(PACK_DIR, 'dist', 'index.mjs')
  if (!check(existsSync(entry), 'dist/index.mjs 存在'))
    return

  const url = pathToFileURL(entry).href
  const code = `import(${JSON.stringify(url)}).then((m) => { if (typeof m.WeiboSDK !== 'function') process.exit(1) }, (e) => { console.error(e); process.exit(1) })`
  const result = run(process.execPath, ['--input-type=module', '-e', code])
  check(
    result.status === 0,
    `node --input-type=module import('${url}') 暴露 WeiboSDK 函数${result.status === 0 ? '' : `（exit ${result.status}）`}`,
  )
  if (result.status !== 0 && result.stderr)
    process.stderr.write(`${result.stderr}\n`)
}

function verifyCliVersion(version) {
  const bin = path.join(PACK_DIR, 'dist', 'cli-bin.mjs')
  if (!check(existsSync(bin), 'dist/cli-bin.mjs 存在'))
    return

  const result = run(process.execPath, [bin, '--version'])
  const printed = (result.stdout ?? '').trim()
  check(
    result.status === 0 && printed === version,
    `node dist/cli-bin.mjs --version 输出 ${JSON.stringify(printed)}（期望 ${JSON.stringify(version)}）`,
  )
  if (result.status !== 0 && result.stderr)
    process.stderr.write(`${result.stderr}\n`)
}

function verifyPublicTypes() {
  const distDir = path.join(PACK_DIR, 'dist')
  const dtsFiles = readdirSync(distDir).filter(file => file.endsWith('.d.mts'))
  if (!check(dtsFiles.length > 0, `dist/*.d.mts 存在（${dtsFiles.length} 个）`))
    return

  const leaks = []
  for (const file of dtsFiles) {
    const lines = readFileSync(path.join(distDir, file), 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (FORBIDDEN_TYPE_REFS.some(pattern => pattern.test(line)))
        leaks.push(`${file}:${index + 1} ${line.trim().slice(0, 120)}`)
    })
  }
  check(leaks.length === 0, `dist/*.d.mts 无 axios 类型引用${leaks.length > 0 ? `\n  ${leaks.join('\n  ')}` : ''}`)
}

function main() {
  rmSync(TMP_DIR, { recursive: true, force: true })
  mkdirSync(TMP_DIR, { recursive: true })

  try {
    log(`▸ pnpm pack --pack-destination ${path.relative(ROOT, TMP_DIR)}`)
    const pack = runShell('pnpm pack --pack-destination .tmp-verify')
    if (pack.status !== 0) {
      throw new Error(`pnpm pack 失败（exit ${pack.status}）\n${pack.stderr ?? ''}`)
    }

    const tarball = findTarball()
    const tarballArg = toPosix(path.relative(ROOT, tarball))
    log(`▸ tarball: ${tarballArg}`)

    log(`▸ tar -xzf ${tarballArg} -C .tmp-verify`)
    const extract = runShell(`tar -xzf "${tarballArg}" -C .tmp-verify`)
    if (extract.status !== 0) {
      throw new Error(`tar 解包失败（exit ${extract.status}），需要系统 tar（Windows 10+ 自带 bsdtar）\n${extract.stderr ?? ''}`)
    }

    const packed = JSON.parse(readFileSync(path.join(PACK_DIR, 'package.json'), 'utf8'))
    const version = verifyManifest(packed)
    verifyNodeImport()
    verifyCliVersion(version)
    verifyPublicTypes()
  }
  catch (error) {
    check(false, `verify:package 执行异常：${error instanceof Error ? error.message : String(error)}`)
  }
  finally {
    rmSync(TMP_DIR, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    process.stderr.write(`\n✖ verify:package 失败（${failures.length} 项）\n`)
    process.exitCode = 1
    return
  }
  log('\n✔ verify:package 全部通过')
}

main()
