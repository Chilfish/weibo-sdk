import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { searchUsersSpec } from '~/services/endpoints/search'

describe('search users endpoint (m.weibo.cn)', () => {
  it('validates real search users fixture (page 2)', async () => {
    const url = new URL('../../fixtures/raw/search_users_p2.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const result = searchUsersSpec.schema.safeParse(raw)
    if (!result.success)
      console.error(JSON.stringify(result.error.issues.slice(0, 5), null, 2))

    expect(result.success).toBe(true)
    expect(result.data!.ok).toBe(1)
    expect(result.data!.data.cards.length).toBeGreaterThan(0)
    expect(result.data!.data.cardlistInfo).toBeDefined()
  })

  it('validates real search users fixture (page 3)', async () => {
    const url = new URL('../../fixtures/raw/search_users_p3.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const result = searchUsersSpec.schema.safeParse(raw)
    expect(result.success).toBe(true)

    // Extract user cards (card_type=11)
    const userCards = result.data!.data.cards
      .filter(c => c.card_type === 11)
      .flatMap(c => c.card_group || [])
    expect(userCards.length).toBeGreaterThan(0)
    for (const item of userCards) {
      expect(item.user).toBeDefined()
      expect(typeof item.user!.screen_name).toBe('string')
    }
  })

  it('buildContainerId encodes correctly', async () => {
    // Test that the URL is constructed correctly
    const req = searchUsersSpec.buildResource({ q: '新闻', page: 2 })
    expect(req.url).toContain('m.weibo.cn/api/container/getIndex')
    expect(req.url).toContain('containerid=')
    expect(req.url).toContain('page=2')
    expect(req.url).toContain('page_type=searchall')
  })
})
