import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function source(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8')
}

/**
 * ADR-017：两条归档管线并存，但枚举状态机只能有一个。
 *
 * 这组测试不验证行为（行为由各自用例覆盖），而是防止后续改动把
 * `archive/phases/*` 的循环复制进 `userArchive`，再次长成两套分叉状态机。
 */
describe('archive pipeline boundary (ADR-017)', () => {
  it('userArchive reuses streamArchive instead of reimplementing enumeration', () => {
    const text = source('src/services/public/UserArchiveService.ts')

    expect(text).toMatch(/streamArchive:/)
    expect(text).not.toMatch(/archive\/phases/)
    expect(text).not.toMatch(/ArchiveRuntime|resolveEnabledPhases|advancePhase/)
  })

  it('userArchive exposes no cursor checkpoint on its public options', () => {
    const text = source('src/types/archive/IUserArchive.ts')
    const block = text.match(/export interface UserArchiveOptions \{[\s\S]*?\n\}/)?.[0] ?? ''

    expect(block).not.toBe('')
    expect(block).not.toMatch(/checkpoint/i)
  })
})
