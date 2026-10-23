import type { AxiosRequestConfig } from 'axios'
import { readFile } from 'node:fs/promises'
import { createFakeAxios, NoopRateLimitService, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { likersSpec } from '~/services/endpoints/likers'
import { TweetService } from '~/services/public/TweetService'

const MID = '5355873276528697'
const LIKERS_URL = 'https://m.weibo.cn/api/attitudes/show'

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  const raw = await readFile(new URL(`../../fixtures/raw/${name}`, import.meta.url), 'utf8')
  return JSON.parse(raw)
}

interface Harness {
  service: TweetService
  telemetry: TelemetryCollector
  requested: number[]
  lastConfig: () => AxiosRequestConfig | undefined
}

function createService(responses: Record<number, unknown>): Harness {
  const requested: number[] = []
  const telemetry = new TelemetryCollector()
  const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
    const page = Number(cfg.params?.page ?? 1)
    requested.push(page)
    return responses[page] ?? { ok: 1, data: { max: page, total_number: 0, data: null } }
  })
  const service = new TweetService(
    { cookie: 'SUB=abc', telemetry },
    { transport, rateLimitService: new NoopRateLimitService() as any, telemetry },
  )
  return { service, telemetry, requested, lastConfig: getLastConfig }
}

describe('likers fixture (D8)', () => {
  it.each(['likers_p1.json', 'likers_p2.json', 'likers_end.json'])(
    'validates real fixture %s against likersSpec.schema',
    async (file) => {
      const raw = await loadFixture(file)
      const result = likersSpec.schema.safeParse(raw)
      if (!result.success)
        console.error(result.error.issues.slice(0, 5))
      expect(result.success).toBe(true)
    },
  )
})

describe('tweetService.likers', () => {
  it('normalizes the real first page and sends the numeric mid', async () => {
    const p1 = await loadFixture('likers_p1.json')
    const { service, telemetry, lastConfig } = createService({ 1: p1 })

    const result = await service.likers(MID)

    expect(result.page).toBe(2)
    expect(result.total).toBe(107)
    expect(result.hasMore).toBe(true)
    expect(result.likers).toHaveLength(50)
    expect(result.likers[0].id).not.toBe('')
    expect(result.likers[0].name).not.toBe('')
    expect(result.likers[0].likedAt).toBe('<DATE>')
    expect(result.likers[0].source).toBe('iPad客户端')

    const cfg = lastConfig()
    expect(cfg?.url).toBe(LIKERS_URL)
    expect(cfg?.params).toEqual({ id: MID, page: 1 })
    expect(cfg?.headers?.referer).toBe(`https://m.weibo.cn/status/${MID}`)

    expect(telemetry.byName('normalize_done')).toEqual([
      expect.objectContaining({ model: 'TweetLiker', count: 50 }),
    ])
  })

  it('treats the out-of-range page (data: null) as the end', async () => {
    const end = await loadFixture('likers_end.json')
    const { service } = createService({ 3: end })

    const result = await service.likers(MID, { page: 3 })

    expect(result.page).toBe(4)
    expect(result.hasMore).toBe(false)
    expect(result.likers).toEqual([])
    expect(result.total).toBe(107)
  })

  it('treats the real empty-state response (ok: 0, no data) as an empty page', async () => {
    const empty = await loadFixture('likers_empty.json')
    expect(likersSpec.schema.safeParse(empty).success).toBe(true)

    const { service, telemetry } = createService({ 1: empty })
    const result = await service.likers(MID)

    expect(result).toEqual({ page: 2, hasMore: false, likers: [] })
    expect(telemetry.byName('normalize_done')).toEqual([
      expect.objectContaining({ model: 'TweetLiker', count: 0 }),
    ])
  })

  it('stops the stream immediately on the empty state', async () => {
    const empty = await loadFixture('likers_empty.json')
    const { service, requested } = createService({ 1: empty })

    const ids: string[] = []
    for await (const liker of service.streamLikers(MID))
      ids.push(liker.id)

    expect(ids).toEqual([])
    expect(requested).toEqual([1])
  })

  it('streams p1 + p2 and stops at the null page without duplicates', async () => {
    const [p1, p2, end] = await Promise.all([
      loadFixture('likers_p1.json'),
      loadFixture('likers_p2.json'),
      loadFixture('likers_end.json'),
    ])
    const { service, requested } = createService({ 1: p1, 2: p2, 3: end })

    const ids: string[] = []
    for await (const liker of service.streamLikers(MID))
      ids.push(liker.id)

    expect(requested).toEqual([1, 2, 3])
    expect(ids).toHaveLength(95)
    expect(new Set(ids).size).toBe(95)
  })

  it('treats page=0 as the first page', async () => {
    const p1 = await loadFixture('likers_p1.json')
    const { service, requested } = createService({ 1: p1 })

    await service.likers(MID, { page: 0 })

    expect(requested).toEqual([1])
  })
})
