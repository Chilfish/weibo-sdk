import type { AxiosRequestConfig } from 'axios'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFakeAxios, NoopRateLimitService, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { MediaService } from '~/services/public/MediaService'
import { MediaType } from '~/types/domain/ITweet'

function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join('tests/fixtures/raw', name), 'utf8'))
}

interface Harness {
  service: MediaService
  telemetry: TelemetryCollector
  requests: AxiosRequestConfig[]
}

function createService(handler: (config: AxiosRequestConfig) => unknown): Harness {
  const requests: AxiosRequestConfig[] = []
  const telemetry = new TelemetryCollector()
  const { client } = createFakeAxios(async (config) => {
    requests.push(config)
    return handler(config)
  })
  const service = new MediaService(
    { cookie: 'SUB=abc', telemetry },
    { client, rateLimitService: new NoopRateLimitService() as any, telemetry },
  )
  return { service, telemetry, requests }
}

describe('mediaService (component, real fixtures)', () => {
  it('normalizes the real image wall page and emits normalize_done', async () => {
    const p1 = loadFixture('image_wall_p1.json')
    const { service, telemetry, requests } = createService(() => p1)

    const result = await service.listImages('2365795232')

    // 真实样本第 16 条缺 pid（破损条目），服务层过滤后剩 22 条
    expect(result.assets).toHaveLength(22)
    expect(result.sinceId).toBe(p1.data.since_id)
    expect(result.hasMore).toBe(true)
    expect(result.assets[0].type).toBe(MediaType.LIVEPHOTO)
    expect(result.assets[0].url).toMatch(/^https:\/\/wx3\.sinaimg\.cn\/large\//)

    expect(requests[0].url).toBe('https://weibo.com/ajax/profile/getImageWall')
    expect(requests[0].params).toEqual({ uid: '2365795232', sinceid: '0' })
    expect(requests[0].headers?.referer).toBe('https://weibo.com/u/2365795232')

    expect(telemetry.byName('normalize_done')).toEqual([
      expect.objectContaining({ model: 'UserMediaAsset', count: 22 }),
    ])
  })

  it('streams image wall pages, dedupes by pid and stops on an empty page', async () => {
    const p1 = loadFixture('image_wall_p1.json')
    const p2 = loadFixture('image_wall_p2.json')
    const { service, requests } = createService((config) => {
      const sinceid = String(config.params?.sinceid)
      if (sinceid === '0')
        return p1
      if (sinceid === String(p1.data.since_id))
        return p2
      return { ok: 1, data: { list: [], since_id: '' } }
    })

    const ids: string[] = []
    const progress: number[] = []
    for await (const asset of service.streamImages('2365795232', {
      onProgress: (p) => {
        progress.push(p.processed)
      },
    })) {
      ids.push(asset.id)
    }

    expect(ids).toHaveLength(45)
    expect(new Set(ids).size).toBe(45)
    expect(progress).toEqual([22, 45])
    expect(requests.map(r => r.params?.sinceid)).toEqual([
      '0',
      p1.data.since_id,
      p2.data.since_id,
    ])
  })

  it('streamImages stops at maxItems without fetching the next page', async () => {
    const p1 = loadFixture('image_wall_p1.json')
    const { service, requests } = createService(() => p1)

    const ids: string[] = []
    for await (const asset of service.streamImages('2365795232', { maxItems: 5 }))
      ids.push(asset.id)

    expect(ids).toHaveLength(5)
    expect(requests).toHaveLength(1)
  })

  it('normalizes the real video waterfall page', async () => {
    const p1 = loadFixture('waterfall_p1.json')
    const { service, telemetry, requests } = createService(() => p1)

    const result = await service.listVideos('2365795232')

    expect(result.assets).toHaveLength(17)
    expect(result.cursor).toBe(p1.data.next_cursor)
    expect(result.hasMore).toBe(true)
    expect(result.assets[0]).toEqual(expect.objectContaining({
      type: MediaType.VIDEO,
      sourceMblogId: p1.data.list[0].mblogid,
    }))

    expect(requests[0].url).toBe('https://weibo.com/ajax/profile/getWaterFallContent')
    expect(requests[0].params).toEqual({ uid: '2365795232', cursor: '0' })
    expect(telemetry.byName('normalize_done')[0]).toEqual(
      expect.objectContaining({ model: 'UserMediaAsset', count: 17 }),
    )
  })

  it('streams video waterfall pages and stops on an empty page', async () => {
    const p1 = loadFixture('waterfall_p1.json')
    const p2 = loadFixture('waterfall_p2.json')
    const { service, requests } = createService((config) => {
      const cursor = String(config.params?.cursor)
      if (cursor === '0')
        return p1
      if (cursor === String(p1.data.next_cursor))
        return p2
      return { ok: 1, data: { list: [], next_cursor: '' } }
    })

    const ids: string[] = []
    for await (const asset of service.streamVideos('2365795232'))
      ids.push(asset.id)

    expect(ids).toHaveLength(25)
    expect(new Set(ids).size).toBe(25)
    expect(requests.map(r => r.params?.cursor)).toEqual([
      '0',
      p1.data.next_cursor,
      p2.data.next_cursor,
    ])
  })

  it('lists albums via getImageWall?has_album=true (pc containerid)', async () => {
    const wall = loadFixture('image_wall_with_albums.json')
    const { service, telemetry, requests } = createService(() => wall)

    const result = await service.listAlbums('1749127163')

    expect(result.albums).toHaveLength(2)
    expect(result.albums[0]).toEqual({
      containerId: wall.data.album_list[0].containerid,
      title: '原创',
      coverUrl: wall.data.album_list[0].pic,
    })
    expect(requests[0].url).toBe('https://weibo.com/ajax/profile/getImageWall')
    expect(requests[0].params).toEqual({ uid: '1749127163', sinceid: 0, has_album: true })
    expect(telemetry.byName('normalize_done')[0]).toEqual(
      expect.objectContaining({ model: 'UserAlbum', count: 2 }),
    )
  })

  it('lists album photos and streams across since_id pages', async () => {
    const p1 = loadFixture('album_detail_p1.json')
    const p2 = loadFixture('album_detail_p2.json')
    const { service, requests } = createService((config) => {
      const since = String(config.params?.since_id)
      if (since === '0')
        return p1
      if (since === String(p1.data.since_id))
        return p2
      return { ok: 1, data: { list: [], since_id: 0, type: '' } }
    })

    const first = await service.listAlbumPhotos('album-1')
    expect(first.assets).toHaveLength(24)
    expect(first.sinceId).toBe(p1.data.since_id)
    expect(first.hasMore).toBe(true)

    const ids: string[] = []
    const progress: number[] = []
    for await (const asset of service.streamAlbumPhotos('album-1', {
      onProgress: (p) => {
        progress.push(p.processed)
      },
    })) {
      ids.push(asset.id)
    }

    expect(ids).toHaveLength(39)
    expect(new Set(ids).size).toBe(39)
    expect(progress).toEqual([24, 39])
    expect(requests.map(r => r.params?.since_id)).toEqual([
      '0',
      '0',
      p1.data.since_id,
    ])
  })

  it('normalizes negative cursors to the first page', async () => {
    const p1 = loadFixture('image_wall_p1.json')
    const { service: imageService, requests: imageRequests } = createService(() => p1)
    await imageService.listImages('2365795232', { sinceId: -1 })
    expect(imageRequests[0].params).toEqual({ uid: '2365795232', sinceid: '0' })

    const w1 = loadFixture('waterfall_p1.json')
    const { service: videoService, requests: videoRequests } = createService(() => w1)
    await videoService.listVideos('2365795232', { cursor: -1 })
    expect(videoRequests[0].params).toEqual({ uid: '2365795232', cursor: '0' })
  })
})
