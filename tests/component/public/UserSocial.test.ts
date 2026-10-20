import type { AxiosRequestConfig } from 'axios'
import { readFile } from 'node:fs/promises'
import { createFakeAxios, NoopRateLimitService, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { feedGroupsSpec, mblogGroupsSpec } from '~/services/endpoints/groups'
import { mentionsSpec } from '~/services/endpoints/mentions'
import { UserService } from '~/services/public/UserService'

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  const raw = await readFile(new URL(`../../fixtures/raw/${name}`, import.meta.url), 'utf8')
  return JSON.parse(raw)
}

interface Harness {
  service: UserService
  telemetry: TelemetryCollector
  requests: Array<Record<string, unknown> | undefined>
  lastConfig: () => AxiosRequestConfig | undefined
}

function createService(handler: (cfg: AxiosRequestConfig) => unknown): Harness {
  const requests: Array<Record<string, unknown> | undefined> = []
  const telemetry = new TelemetryCollector()
  const { client, getLastConfig } = createFakeAxios(async (cfg) => {
    requests.push(cfg.params as Record<string, unknown> | undefined)
    return handler(cfg)
  })
  const service = new UserService(
    { cookie: 'SUB=abc', telemetry },
    { client, rateLimitService: new NoopRateLimitService() as any, telemetry },
  )
  return { service, telemetry, requests, lastConfig: getLastConfig }
}

function mentionsHandler(pages: Record<string, unknown>) {
  return (cfg: AxiosRequestConfig) => {
    const key = String(cfg.params?.max_id ?? cfg.params?.page ?? 'first')
    return pages[key] ?? { ok: 1, data: { statuses: [], next_cursor: 0, total_number: 0 } }
  }
}

describe('mentions fixture (D9)', () => {
  it.each(['mentions_p1.json', 'mentions_p2.json', 'mentions_end.json'])(
    'validates real fixture %s against mentionsSpec.schema',
    async (file) => {
      const raw = await loadFixture(file)
      const result = mentionsSpec.schema.safeParse(raw)
      if (!result.success)
        console.error(result.error.issues.slice(0, 5))
      expect(result.success).toBe(true)
    },
  )
})

describe('userService.listMentions / streamMentions', () => {
  it('normalizes the real first page and returns the next cursor', async () => {
    const p1 = await loadFixture('mentions_p1.json')
    const { service, telemetry, lastConfig } = createService(mentionsHandler({ first: p1 }))

    const result = await service.listMentions()

    expect(result.cursor).toBe(5337232611217339)
    expect(result.total).toBe(994)
    expect(result.hasMore).toBe(true)
    expect(result.tweets).toHaveLength(16)
    expect(result.tweets[0].mblogId).toBe('RmrOL2w2Y')

    const cfg = lastConfig()
    expect(cfg?.url).toBe('https://weibo.com/ajax/statuses/mentions')
    expect(cfg?.params).toEqual({})

    expect(telemetry.byName('normalize_done')).toEqual([
      expect.objectContaining({ model: 'Tweet', count: 16 }),
    ])
  })

  it('streams p1 + p2 + end using max_id and stops on next_cursor=0', async () => {
    const [p1, p2, end] = await Promise.all([
      loadFixture('mentions_p1.json'),
      loadFixture('mentions_p2.json'),
      loadFixture('mentions_end.json'),
    ])
    const { service, requests } = createService(mentionsHandler({
      first: p1,
      5337232611217339: p2,
      5334115169868323: end,
    }))

    const ids: string[] = []
    for await (const tweet of service.streamMentions())
      ids.push(tweet.mblogId)

    expect(ids).toHaveLength(27)
    expect(new Set(ids).size).toBe(27)
    expect(requests).toEqual([
      {},
      { max_id: 5337232611217339 },
      { max_id: 5334115169868323 },
    ])
  })
})

describe('userService.groups / mblogGroups (D11)', () => {
  it('flattens feed/allGroups categories', async () => {
    const raw = await loadFixture('feed_groups.json')
    expect(feedGroupsSpec.schema.safeParse(raw).success).toBe(true)
    const { service, lastConfig } = createService(() => raw)

    const groups = await service.groups()

    expect(groups.length).toBeGreaterThan(10)
    expect(groups[0]).toMatchObject({ title: '全部关注', category: '默认分组' })
    expect(groups.every(group => group.id.length > 0)).toBe(true)
    expect(lastConfig()?.url).toBe('https://weibo.com/ajax/feed/allGroups')
  })

  it('normalizes mblog/querygroup join_groups', async () => {
    const raw = await loadFixture('mblog_groups.json')
    expect(mblogGroupsSpec.schema.safeParse(raw).success).toBe(true)
    const { service, lastConfig } = createService(() => raw)

    const groups = await service.mblogGroups()

    expect(groups).toHaveLength(2)
    expect(groups[0].name).toBe('海洋鱼')
    expect(groups[0].systemName).toBe('海洋鱼')
    expect(groups[1].name).toBe('melingkk、Wysteri...')
    expect(groups.every(group => group.id.length > 0)).toBe(true)
    expect(lastConfig()?.url).toBe('https://weibo.com/ajax/mblog/querygroup')
  })
})
