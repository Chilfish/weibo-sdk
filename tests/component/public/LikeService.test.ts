import type { AxiosRequestConfig } from 'axios'
import { readFile } from 'node:fs/promises'
import { createFakeAxios, NoopRateLimitService, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { LikeService } from '~/services/public/LikeService'

/** 真实 fixture（已脱敏）：`/ajax/statuses/likelist` page=1 / page=2 / 越界 page=999。 */
async function loadFixture(name: string): Promise<Record<string, unknown>> {
  const raw = await readFile(new URL(`../../fixtures/raw/${name}`, import.meta.url), 'utf8')
  return JSON.parse(raw)
}

interface Harness {
  service: LikeService
  telemetry: TelemetryCollector
  requested: number[]
  lastConfig: () => AxiosRequestConfig | undefined
}

function createService(responses: Record<number, unknown>): Harness {
  const requested: number[] = []
  const telemetry = new TelemetryCollector()
  const { client, getLastConfig } = createFakeAxios(async (cfg) => {
    const page = Number(cfg.params?.page ?? 1)
    requested.push(page)
    return responses[page] ?? { ok: 1, data: { list: [] } }
  })
  const service = new LikeService(
    { cookie: 'SUB=abc', telemetry },
    { client, rateLimitService: new NoopRateLimitService() as any, telemetry },
  )
  return { service, telemetry, requested, lastConfig: getLastConfig }
}

describe('likeService (component, real fixtures)', () => {
  it('normalizes the real first page and emits normalize_done', async () => {
    const p1 = await loadFixture('likes_p1.json')
    const { service, telemetry, lastConfig } = createService({ 1: p1 })

    const result = await service.listByUserId('7679065628')

    expect(result.page).toBe(2)
    expect(result.hasMore).toBe(true)
    expect(result.tweets).toHaveLength(18)
    // 真实 fixture 首条 mblogid / 无 user 的条目也能归一化（user 字段缺失 → 空串）
    expect(result.tweets[0].mblogId).toBe('RgoswfsnP')
    for (const tweet of result.tweets) {
      expect(typeof tweet.mblogId).toBe('string')
      expect(tweet.mblogId.length).toBeGreaterThan(0)
      expect(Array.isArray(tweet.media)).toBe(true)
    }

    const cfg = lastConfig()
    expect(cfg?.url).toBe('https://weibo.com/ajax/statuses/likelist')
    expect(cfg?.params).toEqual({ uid: '7679065628', page: 1 })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/7679065628')

    expect(telemetry.byName('normalize_done')).toEqual([
      expect.objectContaining({
        model: 'Tweet',
        count: 18,
        duration_ms: expect.any(Number),
      }),
    ])
  })

  it('streams p1 + p2 and stops on the out-of-range page (list: [])', async () => {
    const [p1, p2, end] = await Promise.all([
      loadFixture('likes_p1.json'),
      loadFixture('likes_p2.json'),
      loadFixture('likes_end.json'),
    ])
    const { service, telemetry, requested } = createService({ 1: p1, 2: p2, 3: end })

    const mblogIds: string[] = []
    for await (const tweet of service.streamByUserId('7679065628'))
      mblogIds.push(tweet.mblogId)

    // 两页各 18 条且无重复；越界页返回 200 + 空数组，不发 page=0
    expect(requested).toEqual([1, 2, 3])
    expect(mblogIds).toHaveLength(36)
    expect(new Set(mblogIds).size).toBe(36)

    // 每页一次 normalize_done（空页不产出，也不打点）
    const events = telemetry.byName('normalize_done')
    expect(events).toHaveLength(2)
    expect(events.map(event => event.event_name === 'normalize_done' ? event.count : undefined)).toEqual([18, 18])
  })

  it('returns an empty page for an out-of-range page without throwing', async () => {
    const end = await loadFixture('likes_end.json')
    const { service, telemetry } = createService({ 999: end })

    const result = await service.listByUserId('7679065628', { page: 999 })

    expect(result).toEqual({ page: 1000, hasMore: false, tweets: [] })
    expect(telemetry.byName('normalize_done')[0]).toEqual(expect.objectContaining({ count: 0 }))
  })
})
