import type { AxiosRequestConfig } from 'axios'
import { readFile } from 'node:fs/promises'
import { createFakeAxios, NoopRateLimitService, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { messageAttitudesSpec, messageCommentsSpec } from '~/services/endpoints/notifications'
import { NotificationService } from '~/services/public/NotificationService'

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  const raw = await readFile(new URL(`../../fixtures/raw/${name}`, import.meta.url), 'utf8')
  return JSON.parse(raw)
}

interface Harness {
  service: NotificationService
  telemetry: TelemetryCollector
  requests: Array<Record<string, unknown> | undefined>
  lastConfig: () => AxiosRequestConfig | undefined
}

function createService(handler: (cfg: AxiosRequestConfig) => unknown): Harness {
  const requests: Array<Record<string, unknown> | undefined> = []
  const telemetry = new TelemetryCollector()
  const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
    requests.push(cfg.params as Record<string, unknown> | undefined)
    return handler(cfg)
  })
  const service = new NotificationService(
    { cookie: 'SUB=abc', telemetry },
    { transport, rateLimitService: new NoopRateLimitService() as any, telemetry },
  )
  return { service, telemetry, requests, lastConfig: getLastConfig }
}

function byCursor(pages: Record<string, unknown>, empty: unknown) {
  return (cfg: AxiosRequestConfig) => {
    const key = String(cfg.params?.max_id ?? cfg.params?.page ?? 'first')
    return pages[key] ?? empty
  }
}

const EMPTY_COMMENTS = { ok: 1, data: { comments: [], next_cursor: 0, total_number: 0 } }
const EMPTY_ATTITUDES = { ok: 1, data: { attitudes: [], next_cursor: 0, total_number: 0 } }

describe('notification fixtures (D10)', () => {
  it.each(['message_cmt_p1.json', 'message_cmt_p2.json', 'message_cmt_end.json'])(
    'validates comments fixture %s',
    async (file) => {
      const raw = await loadFixture(file)
      expect(messageCommentsSpec.schema.safeParse(raw).success).toBe(true)
    },
  )

  it.each(['message_attitudes_p1.json', 'message_attitudes_p2.json', 'message_attitudes_end.json'])(
    'validates attitudes fixture %s (missing status is allowed)',
    async (file) => {
      const raw = await loadFixture(file)
      expect(messageAttitudesSpec.schema.safeParse(raw).success).toBe(true)
    },
  )
})

describe('notificationService comments', () => {
  it('normalizes the real first page into comment + parent tweet', async () => {
    const p1 = await loadFixture('message_cmt_p1.json')
    const { service, telemetry, lastConfig } = createService(() => p1)

    const result = await service.listComments()

    expect(result.cursor).toBe(5344935282215124)
    expect(result.total).toBe(1187)
    expect(result.hasMore).toBe(true)
    expect(result.items).toHaveLength(18)
    expect(result.items[0].comment.id).not.toBe('')
    expect(result.items[0].comment.parentMblogId).toBe(result.items[0].tweet.mblogId)
    expect(result.items[0].tweet.mblogId.length).toBeGreaterThan(0)

    const cfg = lastConfig()
    expect(cfg?.url).toBe('https://weibo.com/ajax/message/cmt')
    expect(cfg?.params).toEqual({})
    expect(telemetry.byName('normalize_done')).toEqual([
      expect.objectContaining({ model: 'CommentNotification', count: 18 }),
    ])
  })

  it('streams p1 + p2 + end with max_id and stops on next_cursor=0', async () => {
    const [p1, p2, end] = await Promise.all([
      loadFixture('message_cmt_p1.json'),
      loadFixture('message_cmt_p2.json'),
      loadFixture('message_cmt_end.json'),
    ])
    const { service, requests } = createService(byCursor({
      first: p1,
      5344935282215124: p2,
      5341756192718925: end,
    }, EMPTY_COMMENTS))

    const ids: string[] = []
    for await (const item of service.streamComments())
      ids.push(item.comment.id)

    expect(ids).toHaveLength(38)
    expect(new Set(ids).size).toBe(38)
    expect(requests).toEqual([
      {},
      { max_id: 5344935282215124 },
      { max_id: 5341756192718925 },
    ])
  })
})

describe('notificationService likes', () => {
  it('skips items whose target tweet was deleted (missing status)', async () => {
    const p1 = await loadFixture('message_attitudes_p1.json')
    const { service, telemetry } = createService(() => p1)

    const result = await service.listLikes()

    expect(result.cursor).toBe(5353899871701173)
    expect(result.total).toBe(2955)
    expect(result.items).toHaveLength(19) // 真实样本 20 条，其中 1 条没有 status
    expect(result.items.every(item => item.tweet.mblogId.length > 0)).toBe(true)
    expect(telemetry.byName('normalize_done')).toEqual([
      expect.objectContaining({ model: 'LikeNotification', count: 19 }),
    ])
  })

  it('streams p1 + p2 + end with max_id', async () => {
    const [p1, p2, end] = await Promise.all([
      loadFixture('message_attitudes_p1.json'),
      loadFixture('message_attitudes_p2.json'),
      loadFixture('message_attitudes_end.json'),
    ])
    const { service, requests } = createService(byCursor({
      first: p1,
      5353899871701173: p2,
      5352968179422836: end,
    }, EMPTY_ATTITUDES))

    const ids: string[] = []
    for await (const item of service.streamLikes())
      ids.push(item.id)

    expect(ids).toHaveLength(37) // 19 + 18（每页各有一条缺失 status）
    expect(new Set(ids).size).toBe(37)
    expect(requests).toEqual([
      {},
      { max_id: 5353899871701173 },
      { max_id: 5352968179422836 },
    ])
  })
})
