import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface ConditionalExport {
  types?: string
  default?: string
}

interface PackageJson {
  name?: string
  bin?: Record<string, string>
  engines?: { node?: string }
  exports?: Record<string, unknown>
  main?: string
  module?: string
  types?: string
  sideEffects?: boolean
}

function getRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../')
}

async function readPackageJson(): Promise<PackageJson> {
  const pkgPath = path.join(getRepoRoot(), 'package.json')
  return JSON.parse(await readFile(pkgPath, 'utf8')) as PackageJson
}

describe('package exports', () => {
  it('keeps package.json#exports stable', async () => {
    const pkg = await readPackageJson()

    // 发布身份：scoped 包名 + 稳定的 CLI 二进制名（bin 指向纯执行入口，命令树在 ./cli）
    expect(pkg.name).toBe('@chilfish/weibo-sdk')
    expect(pkg.bin).toEqual({ 'weibo-cli': './dist/cli-bin.mjs' })
    expect(pkg.sideEffects).toBe(false)
    expect(pkg.types).toBe('./dist/index.d.mts')
    // exports field supersedes main/module (tsdown auto-manages)
    expect(pkg.exports).toBeDefined()

    // 每个公开子路径都是 `types` 优先的条件对象（node16 / bundler 解析都依赖它）
    expect(pkg.exports!['.']).toEqual({
      types: './dist/index.d.mts',
      default: './dist/index.mjs',
    })
    expect(pkg.exports!['./cli']).toEqual({
      types: './dist/cli.d.mts',
      default: './dist/cli.mjs',
    })
    // bin 入口是内部实现，不暴露为子路径
    expect(pkg.exports!['./cli-bin']).toBeUndefined()
    expect(pkg.exports!['./package.json']).toBe('./package.json')

    // P2-1：浏览器安全入口（自包含 ESM，无 Node-only API），类型复用 node 入口
    expect(pkg.exports!['./browser']).toEqual({
      types: './dist/index.d.mts',
      default: './dist/browser.mjs',
    })

    // 条件对象里的 types 必须在 default 之前（Node/TS 按顺序匹配）
    for (const key of ['.', './cli', './browser']) {
      const entry = pkg.exports![key] as ConditionalExport | undefined
      expect(Object.keys(entry ?? {})).toEqual(['types', 'default'])
    }

    // postmortem 010 / R3：Node 版本下限与 process.getBuiltinModule 对齐
    expect(pkg.engines?.node).toBe('>=20.16')
  })
})
