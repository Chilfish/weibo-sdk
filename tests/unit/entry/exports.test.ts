import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface PackageJson {
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

    expect(pkg.sideEffects).toBe(false)
    expect(pkg.types).toBe('./dist/index.d.mts')
    // exports field supersedes main/module (tsdown auto-manages)
    expect(pkg.exports).toBeDefined()
    expect(pkg.exports!['.']).toBe('./dist/index.mjs')
    expect(pkg.exports!['./package.json']).toBe('./package.json')
    // tsdown auto-generates cli subpath
    expect(pkg.exports!['./cli']).toBeDefined()
  })
})
