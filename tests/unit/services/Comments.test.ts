import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildCommentsSpec } from '~/services/endpoints/tweet'

describe('comments endpoint schema', () => {
  it('validates real buildComments fixture', async () => {
    const url = new URL('../../fixtures/raw/comments.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const result = buildCommentsSpec.schema.safeParse(raw)

    if (!result.success) {
      console.error(result.error.issues.slice(0, 5))
    }
    expect(result.success).toBe(true)

    const data = result.data!
    expect(data.ok).toBe(1)
    expect(data.data.length).toBeGreaterThan(0)
    expect(data.max_id).toBeDefined()
    expect(data.filter_group).toBeDefined()
  })

  it('validates comment items have required fields', async () => {
    const url = new URL('../../fixtures/raw/comments.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const result = buildCommentsSpec.schema.safeParse(raw)
    expect(result.success).toBe(true)

    for (const comment of result.data!.data) {
      expect(typeof comment.idstr).toBe('string')
      expect(typeof comment.text).toBe('string')
      expect(comment.user).toBeDefined()
      expect(typeof comment.user.screen_name).toBe('string')
    }
  })

  it('validates full-param buildComments fixture (comments_feed.json)', async () => {
    const url = new URL('../../fixtures/raw/comments_feed.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const result = buildCommentsSpec.schema.safeParse(raw)
    if (!result.success)
      console.error(result.error.issues.slice(0, 5))
    expect(result.success).toBe(true)

    const data = result.data!
    expect(data.ok).toBe(1)
    expect(data.data.length).toBeGreaterThan(0)
    expect(data.total_number).toBeDefined()
  })
})
