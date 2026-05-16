import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { bandUnifiedSpec } from '~/services/endpoints/side'

describe('bandUnified endpoint schema', () => {
  it('validates real bandUnified fixture', async () => {
    const url = new URL('../../fixtures/raw/hot_trends.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const result = bandUnifiedSpec.schema.safeParse(raw)
    if (!result.success)
      console.error(result.error.issues.slice(0, 5))

    expect(result.success).toBe(true)
    expect(result.data!.ok).toBe(1)
    expect(result.data!.data.realtime!.length).toBeGreaterThan(0)
    expect(typeof result.data!.data.realtime![0].word).toBe('string')
  })
})
