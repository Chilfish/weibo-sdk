import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildCommentsSpec } from '~/services/endpoints/tweet'

async function loadFixture(name: string) {
  const url = new URL(`../../fixtures/raw/${name}`, import.meta.url)
  return JSON.parse(await readFile(url, 'utf8'))
}

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
    const raw = await loadFixture('comments_feed.json')

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

describe('buildComments request contract (2026-10-20 real capture)', () => {
  it('rejects the legacy type=feed parameter', () => {
    // 浏览器真实请求不带 type；带上它上游会把首屏砍到 3 条（静默降级）。
    const parsed = buildCommentsSpec.argsSchema!.safeParse({ id: 'MB001', type: 'feed' })
    expect(parsed.success).toBe(false)
  })
})

describe('buildComments real pagination fixtures', () => {
  it('keeps all 20 items from the no-type first page', async () => {
    const data = buildCommentsSpec.schema.parse(await loadFixture('comments_no_type_p1.json'))
    expect(data.data).toHaveLength(20)
    expect(data.total_number).toBe(56)
    expect(data.max_id).toBe(5356111457943584)
    expect(data.trendsText).toBe('已加载全部评论')
  })

  it('keeps 18 / 2 items on later pages and ends at max_id 0', async () => {
    const page2 = buildCommentsSpec.schema.parse(await loadFixture('comments_no_type_p2.json'))
    const end = buildCommentsSpec.schema.parse(await loadFixture('comments_no_type_end.json'))

    expect(page2.data).toHaveLength(18)
    expect(page2.max_id).toBe(5356102935121829)
    expect(end.data).toHaveLength(2)
    expect(end.max_id).toBe(0)
  })

  it('documents the type=feed degradation (3 items instead of 20)', async () => {
    const degraded = buildCommentsSpec.schema.parse(await loadFixture('comments_feed.json'))
    expect(degraded.data).toHaveLength(3)
    expect(degraded.total_number).toBe(11)
  })

  it('exposes firewall partial-visibility markers', async () => {
    const data = buildCommentsSpec.schema.parse(await loadFixture('comments_firewall.json'))
    expect(data.data.length).toBeLessThan(data.total_number!)
    expect(data.max_id).toBe(0)
    expect(data.trendsText).toContain('防火墙')
  })

  it('records an empty hot-order page whose max_id is still non-zero', async () => {
    const data = buildCommentsSpec.schema.parse(await loadFixture('comments_hot_empty.json'))
    expect(data.data).toHaveLength(0)
    expect(data.total_number).toBe(115)
    expect(data.max_id).toBe(82083038794)
  })
})

describe('buildComments image comments (2026-10-20 real capture)', () => {
  it('parses pic_num / mix_media_ids / url_struct.pic_infos', async () => {
    const data = buildCommentsSpec.schema.parse(await loadFixture('comments_pic_multi.json'))

    expect(data.data).toHaveLength(2)
    const multi = data.data.find((comment: any) => comment.pic_num === 2)
    expect(multi).toBeDefined()
    expect(multi!.mix_media_ids).toHaveLength(2)
    expect(multi!.url_struct![0].pic_infos).toBeDefined()
    expect(Object.keys(multi!.url_struct![0].pic_infos!)).toHaveLength(2)
  })
})
