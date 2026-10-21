import type { AxiosRequestConfig } from 'axios'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFakeAxios, NoopRateLimitService, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { TopicService } from '~/services/public/TopicService'

function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join('tests/fixtures/raw', name), 'utf8'))
}

function createService(handler: (config: AxiosRequestConfig) => unknown): {
  service: TopicService
  telemetry: TelemetryCollector
  requests: AxiosRequestConfig[]
} {
  const requests: AxiosRequestConfig[] = []
  const telemetry = new TelemetryCollector()
  const { transport } = createFakeAxios(async (config) => {
    requests.push(config)
    return handler(config)
  })
  const service = new TopicService(
    { cookie: 'SUB=abc', telemetry },
    { transport, rateLimitService: new NoopRateLimitService() as any, telemetry },
  )
  return { service, telemetry, requests }
}

describe('topicService (component, real fixtures)', () => {
  it('returns supertopic categories and emits normalize_done', async () => {
    const cates = loadFixture('stopic_cates.json')
    const { service, telemetry, requests } = createService(() => cates)

    const result = await service.cates()

    expect(result).toHaveLength(19)
    expect(result[0]).toEqual({ id: 123333, name: '最近使用' })
    expect(requests[0].url).toBe('https://weibo.com/ajax/stopic/cates')
    expect(requests[0].params).toEqual({})
    expect(telemetry.byName('normalize_done')[0]).toEqual(
      expect.objectContaining({ model: 'SuperTopicCategory', count: 19 }),
    )
  })

  it('lists a category page with sort_id and reports total pages', async () => {
    const page1 = loadFixture('stopic_list_p1.json')
    const { service, telemetry, requests } = createService(() => page1)

    const result = await service.list({ sortId: 123333 })

    expect(result.topics).toHaveLength(30)
    expect(result.page).toBe(2)
    expect(result.totalPages).toBe(10)
    expect(result.hasMore).toBe(true)
    expect(result.topics[0]).toEqual(expect.objectContaining({
      pageId: page1.data[0].page_id,
      title: page1.data[0].title,
      isCircle: page1.data[0].is_circle === 1,
    }))
    expect(requests[0].url).toBe('https://weibo.com/ajax/stopic/list')
    expect(requests[0].params).toEqual({ page: 1, sort_id: 123333, keyword: '' })
    expect(telemetry.byName('normalize_done')[0]).toEqual(
      expect.objectContaining({ model: 'SuperTopic', count: 30 }),
    )
  })

  it('searches by keyword with sort_id=0', async () => {
    const search = loadFixture('stopic_list_search.json')
    const { service, requests } = createService(() => search)

    const result = await service.list({ keyword: '游戏' })

    expect(result.topics).toHaveLength(21)
    expect(result.totalPages).toBe(2)
    expect(requests[0].params).toEqual({ page: 1, sort_id: 0, keyword: '游戏' })
  })

  it('streams across pages and dedupes by page_id', async () => {
    const p1 = loadFixture('stopic_list_p1.json')
    const p2 = loadFixture('stopic_list_p2.json')
    const { service, requests } = createService((config) => {
      return Number(config.params?.page) === 2 ? p2 : p1
    })

    const ids: string[] = []
    const progress: number[] = []
    for await (const topic of service.stream({
      sortId: 123333,
      maxPages: 2,
      onProgress: (p) => {
        progress.push(p.processed)
      },
    })) {
      ids.push(topic.pageId)
    }

    expect(ids).toHaveLength(50)
    expect(new Set(ids).size).toBe(50)
    expect(progress).toEqual([30, 50])
    expect(requests.map(r => r.params?.page)).toEqual([1, 2])
  })
})
