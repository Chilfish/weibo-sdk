import type { ITweet, TweetMedia } from '~/types/domain/ITweet'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFakeAxios, createFakeMediaHttpClient, createFakeMediaStore, NoopRateLimitService, TelemetryCollector } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { MediaDownloadError } from '~/models/errors/MediaError'
import { MediaService } from '~/services/public/MediaService'
import { MediaType, TweetVisible } from '~/types/domain/ITweet'
import { VerificationType } from '~/types/domain/IUser'

const IMAGE_URL = 'https://wx1.sinaimg.cn/large/p1.jpg'
const VIDEO_URL = 'https://f.video.weibocdn.com/v1.mp4'
const LIVE_IMAGE_URL = 'https://wx1.sinaimg.cn/large/p3.jpg'
const LIVE_VIDEO_URL = 'https://f.video.weibocdn.com/p3.mov'

function makeTweet(media: TweetMedia[]): ITweet {
  return {
    id: '1',
    mblogId: 'M1',
    createdAt: '2025-10-20 09:14:17',
    text: '',
    textHtml: '',
    source: '',
    user: {
      id: '1',
      name: 'tester',
      avatar: '',
      verified: false,
      verifiedType: VerificationType.Personal,
    },
    stats: { likes: 0, comments: 0, reposts: 0 },
    visible: TweetVisible.PUBLIC,
    media,
  }
}

function media(type: MediaType, id: string, imageUrl: string, videoUrl?: string): TweetMedia {
  return { id, type, imageUrl, videoUrl, width: 100, height: 100 }
}

function createHarness(handler: Parameters<typeof createFakeMediaHttpClient>[0]) {
  const fakeStore = createFakeMediaStore()
  const fakeHttp = createFakeMediaHttpClient(handler)
  const telemetry = new TelemetryCollector()
  const service = new MediaService(
    { cookie: 'SUB=abc', telemetry },
    undefined,
    { http: fakeHttp.client, fileStore: fakeStore.store, now: () => 0, random: () => 0 },
  )
  return { service, fakeStore, fakeHttp, telemetry }
}

function byUrlType(url: string): string {
  if (url.endsWith('.mp4'))
    return 'video/mp4'
  if (url.endsWith('.mov'))
    return 'video/quicktime'
  return 'image/jpeg'
}

describe('mediaService download (component)', () => {
  it('downloads images, videos and both LivePhoto variants into flat names', async () => {
    const { service, fakeStore, fakeHttp } = createHarness(request => ({
      status: 200,
      headers: { 'content-type': byUrlType(request.url) },
      chunks: [new Uint8Array([1, 2, 3])],
    }))

    const result = await service.downloadTweetMedia(makeTweet([
      media(MediaType.PIC, 'p1', IMAGE_URL),
      media(MediaType.VIDEO, 'v1', 'https://wx1.sinaimg.cn/large/cover.jpg', VIDEO_URL),
      media(MediaType.LIVEPHOTO, 'p3', LIVE_IMAGE_URL, LIVE_VIDEO_URL),
    ]), { dir: 'out' })

    expect(result.totals).toEqual({ total: 4, downloaded: 4, skipped: 0, failed: 0, planned: 0, bytes: 12 })
    expect(result.failures).toHaveLength(0)
    expect([...fakeStore.files.keys()].sort()).toEqual([
      'out/M1-01-p1.jpg',
      'out/M1-02-v1.mp4',
      'out/M1-03-p3-motion.mov',
      'out/M1-03-p3.jpg',
    ])
    expect(fakeHttp.calls).toHaveLength(4)
    expect(fakeHttp.calls.every(call => call.referer === 'https://weibo.com/')).toBe(true)
  })

  it('downloads repost-chain and retweeted media alongside the tweet\'s own media', async () => {
    const { service, fakeStore } = createHarness(request => ({
      status: 200,
      headers: { 'content-type': byUrlType(request.url) },
      chunks: [new Uint8Array([1])],
    }))

    const tweet: ITweet = {
      ...makeTweet([media(MediaType.PIC, 'own', 'https://wx1.sinaimg.cn/large/own.jpg')]),
      repostChain: [
        {
          index: 0,
          authorName: 'tester',
          text: '顶层转发配图',
          media: [media(MediaType.PIC, 'rp1', 'https://wx1.sinaimg.cn/large/rp1.jpg')],
        },
        {
          index: 1,
          authorName: 'middle',
          text: '中间层配图',
          media: [media(MediaType.PIC, 'rp2', 'https://wx1.sinaimg.cn/large/rp2.jpg')],
        },
      ],
      retweetedStatus: {
        ...makeTweet([media(MediaType.PIC, 'rt1', 'https://wx1.sinaimg.cn/large/rt1.jpg')]),
        mblogId: 'M0',
      },
    }

    const result = await service.downloadTweetMedia(tweet, { dir: 'out' })

    expect(result.totals).toEqual({ total: 4, downloaded: 4, skipped: 0, failed: 0, planned: 0, bytes: 4 })
    expect([...fakeStore.files.keys()].sort()).toEqual([
      'out/M1-01-own.jpg',
      'out/M1-02-rp1.jpg',
      'out/M1-03-rp2.jpg',
      'out/M1-04-rt1.jpg',
    ])
  })

  it('skips existing non-empty files without making HTTP calls', async () => {
    const fakeStore = createFakeMediaStore({ 'out/M1-01-p1.jpg': 10 })
    const fakeHttp = createFakeMediaHttpClient(() => ({ status: 200 }))
    const service = new MediaService(
      { cookie: 'SUB=abc' },
      undefined,
      { http: fakeHttp.client, fileStore: fakeStore.store },
    )

    const result = await service.downloadTweetMedia(makeTweet([
      media(MediaType.PIC, 'p1', IMAGE_URL),
    ]), { dir: 'out' })

    expect(result.totals.skipped).toBe(1)
    expect(result.items[0]).toMatchObject({ status: 'skipped', reason: 'exists', bytes: 10 })
    expect(fakeHttp.calls).toHaveLength(0)
  })

  it('dedupes repeated URLs and reports aggregate failures without stopping', async () => {
    const { service, fakeStore, fakeHttp } = createHarness((request) => {
      if (request.url === IMAGE_URL)
        return { status: 200, headers: { 'content-type': 'text/html' }, chunks: [new Uint8Array([1])] }
      return { status: 200, headers: { 'content-type': 'image/jpeg' }, chunks: [new Uint8Array([1])] }
    })

    const result = await service.downloadTweetMedia(makeTweet([
      media(MediaType.PIC, 'p1', IMAGE_URL),
      media(MediaType.PIC, 'p2', IMAGE_URL),
      media(MediaType.PIC, 'p3', 'https://wx1.sinaimg.cn/large/p3.jpg'),
    ]), { dir: 'out' })

    expect(result.totals.total).toBe(3)
    expect(result.totals.failed).toBe(1)
    expect(result.totals.downloaded).toBe(1)
    expect(result.totals.skipped).toBe(1)
    expect(result.failures[0]).toMatchObject({ mediaId: 'p1', code: 'MEDIA_BAD_RESPONSE' })
    expect(fakeHttp.calls).toHaveLength(2)
    expect(result.errorsFile).toBe('out/M1-media-errors.json')
    expect(fakeStore.files.has('out/M1-media-errors.json')).toBe(true)
  })

  it('does not touch HTTP or disk in dry-run mode', async () => {
    const { service, fakeStore, fakeHttp } = createHarness(() => ({ status: 200 }))

    const result = await service.downloadTweetMedia(makeTweet([
      media(MediaType.PIC, 'p1', IMAGE_URL),
    ]), { dir: 'out', dryRun: true })

    expect(result.items[0]).toMatchObject({ status: 'planned', path: 'out/M1-01-p1.jpg' })
    expect(result.totals).toMatchObject({ total: 1, downloaded: 0, skipped: 0, failed: 0, planned: 1 })
    expect(fakeHttp.calls).toHaveLength(0)
    expect(fakeStore.writes).toHaveLength(0)
  })

  it('requires a Node filesystem', async () => {
    const service = new MediaService(
      { cookie: 'SUB=abc' },
      undefined,
      { fileStore: null },
    )
    await expect(service.downloadTweetMedia(makeTweet([]), { dir: 'out' }))
      .rejects
      .toMatchObject({ code: 'CONFIG_INVALID', context: { field: 'runtime' } })
  })

  it('refreshes an expired URL once via statuses/show', async () => {
    const oldUrl = 'https://wx1.sinaimg.cn/large/old.jpg'
    const newUrl = 'https://wx1.sinaimg.cn/large/new.jpg'
    let showCalls = 0
    const fixture = JSON.parse(readFileSync(join('tests/fixtures/raw/tweet_OgHLUyXYP.json'), 'utf8'))
    const picId = fixture.pic_ids[0]
    const raw = (url: string) => ({
      ...fixture,
      pic_ids: [picId],
      pic_infos: {
        [picId]: {
          ...fixture.pic_infos[picId],
          largest: { ...fixture.pic_infos[picId].largest, url },
        },
      },
    })
    const { transport } = createFakeAxios(async () => {
      showCalls += 1
      return raw(showCalls === 1 ? oldUrl : newUrl)
    })
    const fakeStore = createFakeMediaStore()
    let mediaCalls = 0
    const fakeHttp = createFakeMediaHttpClient(() => {
      mediaCalls += 1
      if (mediaCalls === 1)
        throw new MediaDownloadError('expired', { status: 403, reason: 'expired' })
      return { status: 200, headers: { 'content-type': 'image/jpeg' }, chunks: [new Uint8Array([1, 2])] }
    })
    const service = new MediaService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
      { http: fakeHttp.client, fileStore: fakeStore.store },
    )

    const result = await service.downloadByMblogId('M1', { dir: 'out' })

    expect(showCalls).toBe(2)
    expect(mediaCalls).toBe(2)
    expect(result.totals.downloaded).toBe(1)
    expect(result.items[0]).toMatchObject({ status: 'downloaded', refreshed: true, url: newUrl })
  })

  it('stops scheduling after a fatal storage error', async () => {
    const { service, fakeStore, fakeHttp } = createHarness(() => ({
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      chunks: [new Uint8Array([1])],
    }))
    fakeStore.failOn('rename', new Error('ENOSPC'))

    const result = await service.downloadTweetMedia(makeTweet([
      media(MediaType.PIC, 'p1', IMAGE_URL),
      media(MediaType.PIC, 'p2', 'https://wx1.sinaimg.cn/large/p2.jpg'),
    ]), { dir: 'out', concurrency: 1 })

    expect(result.totals.failed).toBe(1)
    expect(result.totals.skipped).toBeGreaterThanOrEqual(1)
    expect(result.failures[0].code).toBe('MEDIA_STORAGE_FAILED')
    expect(fakeHttp.calls.length).toBeLessThan(2)
  })
})
