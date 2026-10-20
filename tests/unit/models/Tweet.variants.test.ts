import { readFile } from 'node:fs/promises'
import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { isRawTweet, normalizeTweet } from '~/models/data/Tweet'
import { TweetService } from '~/services/public/TweetService'
import { MediaType } from '~/types/domain/ITweet'

type RawTweet = Parameters<typeof normalizeTweet>[0]

async function loadFixture(name: string): Promise<RawTweet> {
  const url = new URL(`../../fixtures/raw/${name}`, import.meta.url)
  return JSON.parse(await readFile(url, 'utf8')) as RawTweet
}

/** 加载「响应信封」形态的 fixture（mymblog / statuses-show 整包，而非单条微博）。 */
async function loadRawJson(name: string): Promise<any> {
  const url = new URL(`../../fixtures/raw/${name}`, import.meta.url)
  return JSON.parse(await readFile(url, 'utf8'))
}

/**
 * 单条微博的最小骨架，字段名/取值风格取自 `tests/fixtures/raw/tweet_QqsYymYOS.json`
 * （真实抓包脱敏后 text 内容退化为 `<TEXT>`，故变种用例按需内联真实字段名 + 可读值）。
 */
function makeRawTweet(overrides: Record<string, unknown>): RawTweet {
  return {
    ok: 1,
    id: '5263078581796878',
    idstr: '5263078581796878',
    mid: '5263078581796878',
    mblogid: 'QqsYymYOS',
    created_at: 'Mon Oct 20 10:00:00 +0800 2025',
    text: '分享一个视频',
    text_raw: '分享一个视频',
    region_name: '发布于 广东',
    source: '微博视频',
    isAd: false,
    isLongText: false,
    visible: { type: 0, list_id: 0 },
    user: {
      id: '1740358225',
      idstr: '1740358225',
      screen_name: '测试用户',
      avatar_hd: 'https://wx1.sinaimg.cn/orj960/avatar.jpg',
      verified: false,
      verified_type: -1,
    },
    attitudes_count: 12,
    comments_count: 3,
    reposts_count: 1,
    ...overrides,
  } as unknown as RawTweet
}

describe('tweet normalization from real fixtures (statuses/show)', () => {
  it('normalizes a plain text tweet', async () => {
    const raw = await loadFixture('tweet_PCN4v8k6W.json')
    const tweet = normalizeTweet(raw)

    expect(tweet.id).toBeTruthy()
    expect(typeof tweet.mblogId).toBe('string')
    expect(tweet.user.id).toBeTruthy()
    expect(tweet.user.name).toBeTruthy()
    expect(tweet.createdAt).toBeTruthy()
    expect(tweet.visible).toBeDefined()
    expect(tweet.stats.likes).toBeGreaterThanOrEqual(0)
    expect(tweet.stats.comments).toBeGreaterThanOrEqual(0)
    expect(tweet.stats.reposts).toBeGreaterThanOrEqual(0)
    // 纯文本微博：无 pic、无 retweet
    expect(tweet.media).toEqual([])
    expect(tweet.retweetedStatus).toBeUndefined()
  })

  it('normalizes a retweet with recursive structure', async () => {
    const raw = await loadFixture('tweet_P6yhlzD3j.json')
    const tweet = normalizeTweet(raw)

    expect(tweet.id).toBeTruthy()
    expect(typeof tweet.mblogId).toBe('string')
    expect(tweet.source).toBeTruthy()
    // 应有转发原微博
    expect(tweet.retweetedStatus).toBeDefined()
    expect(tweet.retweetedStatus!.mblogId).toBeTruthy()
    expect(tweet.retweetedStatus!.user.id).toBeTruthy()
    expect(tweet.retweetedStatus!.user.name).toBeTruthy()
  })

  it('normalizes a multi-pic tweet (9 pics)', async () => {
    const raw = await loadFixture('tweet_OgHLUyXYP.json')
    const tweet = normalizeTweet(raw)

    expect(typeof tweet.mblogId).toBe('string')
    expect(tweet.media.length).toBeGreaterThan(0)
    for (const m of tweet.media) {
      expect(m.id).toBeTruthy()
      expect(m.imageUrl).toBeTruthy()
      expect(m.type).toBeDefined()
    }
    // 9 图微博可能有 livephoto 或 gif
    const types = new Set(tweet.media.map(m => m.type))
    expect(types.has(MediaType.PIC) || types.has(MediaType.LIVEPHOTO) || types.has(MediaType.GIF)).toBe(true)
  })
})

describe('tweet normalization from real fixtures (mymblog)', () => {
  it('normalizes all 9 tweets from mymblog fixture without throwing', async () => {
    const url = new URL('../../fixtures/raw/timeline_u1740358225.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    for (const item of raw.data.list) {
      const tweet = normalizeTweet(item)
      // 核心不变性
      expect(tweet.id).toBeTruthy()
      expect(tweet.mblogId).toBeTruthy()
      expect(tweet.user.id).toBeTruthy()
      expect(tweet.user.name).toBeTruthy()
      expect(tweet.createdAt).toBeTruthy()
      expect(tweet.stats.likes).toBeGreaterThanOrEqual(0)
    }
  })

  it('filters AD tweets (isAd field)', async () => {
    const url = new URL('../../fixtures/raw/timeline_u1740358225.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const ads = raw.data.list.filter((item: any) => item.isAd === true)
    expect(ads.length).toBeGreaterThan(0) // 确认 fixture 中有广告

    // 广告微博也应能 normalize（虽然会被 filterTweets 过滤掉）
    const adTweet = normalizeTweet(ads[0])
    expect(adTweet.id).toBeTruthy()
  })

  it('normalizes retweets from mymblog', async () => {
    const url = new URL('../../fixtures/raw/timeline_u1740358225.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const retweets = raw.data.list.filter((item: any) => item.retweeted_status != null)
    expect(retweets.length).toBeGreaterThan(0)

    for (const rt of retweets) {
      const tweet = normalizeTweet(rt)
      expect(tweet.retweetedStatus).toBeDefined()
      expect(tweet.retweetedStatus!.id).toBeTruthy()
      expect(tweet.retweetedStatus!.mblogId).toBeTruthy()
    }
  })

  it('normalizes long text tweets', async () => {
    const url = new URL('../../fixtures/raw/timeline_u1740358225.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const longTexts = raw.data.list.filter((item: any) => item.isLongText === true)
    expect(longTexts.length).toBeGreaterThan(0)

    const tweet = normalizeTweet(longTexts[0])
    expect(tweet.text.length).toBeGreaterThan(0)
    // 长文通常有 continue_tag 或 page_info
    expect(tweet.pageInfo || tweet.text.length > 0).toBeTruthy()
  })

  it('extracts page_info from tweets with link cards', async () => {
    const url = new URL('../../fixtures/raw/timeline_u1740358225.json', import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const withPageInfo = raw.data.list.filter((item: any) => item.page_info != null)
    expect(withPageInfo.length).toBeGreaterThan(0)

    for (const item of withPageInfo) {
      const tweet = normalizeTweet(item)
      expect(tweet.pageInfo).toBeDefined()
      expect(tweet.pageInfo!.pageId).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// P1-8：四种此前未覆盖的微博形状 —— 视频（mix_media_info）/ 地理 / 长文 / 广告
// 全部离线、确定性：真实 fixture 优先，必要时内联「真实字段名 + 可读值」的最小样本。
// ---------------------------------------------------------------------------

/** 视频变种的最小 raw：mix_media_info.items[0].data.media_info 为待测字段（形状同 tweet_QqsYymYOS）。 */
function makeVideoRaw(mediaInfo: Record<string, unknown>): RawTweet {
  return makeRawTweet({
    mix_media_info: {
      items: [
        {
          type: 'video',
          id: '1034:5299077102108715',
          data: {
            type: '11',
            object_type: 'video',
            object_id: '1034:5299077102108715',
            page_title: '测试用户的微博视频',
            media_info: {
              name: '测试用户的微博视频',
              format: 'mp4',
              media_type: 'video',
              duration: 25,
              big_pic_info: {
                pic_big: { url: 'https://wx1.sinaimg.cn/large/006APoFYly1h.jpg', width: 1280, height: 720 },
                pic_small: { url: 'https://wx1.sinaimg.cn/thumb150/006APoFYly1h.jpg', width: 266, height: 150 },
              },
              ...mediaInfo,
            },
          },
        },
      ],
    },
  })
}

describe('variant 1: video via mix_media_info', () => {
  it('maps a real mix_media_info video item to MediaType.VIDEO (cover / videoUrl / duration / size)', async () => {
    const raw = (await loadFixture('tweet_QqsYymYOS.json')) as any
    const videoItem = raw.mix_media_info.items.find((item: any) => item.type === 'video')
    const mediaInfo = videoItem.data.media_info
    const picBig = mediaInfo.big_pic_info.pic_big

    const tweet = normalizeTweet(raw)
    const video = tweet.media.find(m => m.type === MediaType.VIDEO)

    expect(video).toBeDefined()
    // 混排（多图 + 1 视频）整体走 mix_media_info 分支，视频 id 来自 item.id
    expect(video!.id).toBe(videoItem.id)
    // 封面：无 largecover/largest 时回退 media_info.big_pic_info.pic_big
    expect(video!.imageUrl).toBe(picBig.url)
    // 注：fixture 已脱敏（URL → `<URL>`），mp4_hd/sd 无法在此区分；
    // hd → sd 的优先级由下一条内联用例用可区分 URL 精确断言。
    expect(video!.videoUrl).toBe(mediaInfo.mp4_hd_url)
    expect(video!.duration).toBe(mediaInfo.duration)
    expect(video!.width).toBe(picBig.width)
    expect(video!.height).toBe(picBig.height)
    // 同一条 mix 里的图片仍然保留（图片 + 视频混排，不互相吞掉）
    expect(tweet.media.filter(m => m.type === MediaType.PIC).length).toBeGreaterThan(0)
    expect(tweet.media.filter(m => m.type === MediaType.VIDEO)).toHaveLength(1)
  })

  it('prefers mp4_hd_url, falls back to mp4_sd_url when hd is empty (inline fixture)', () => {
    const hd = normalizeTweet(makeVideoRaw({
      mp4_hd_url: 'https://f.video.weibocdn.com/o0/hd.mp4',
      mp4_sd_url: 'https://f.video.weibocdn.com/o0/sd.mp4',
    }))
    expect(hd.media[0]).toMatchObject({
      id: '1034:5299077102108715',
      type: MediaType.VIDEO,
      imageUrl: 'https://wx1.sinaimg.cn/large/006APoFYly1h.jpg',
      videoUrl: 'https://f.video.weibocdn.com/o0/hd.mp4',
      duration: 25,
      width: 1280,
      height: 720,
    })

    // 实测：部分视频 mp4_hd_url 为空串，此时必须回退 mp4_sd_url
    const sd = normalizeTweet(makeVideoRaw({
      mp4_hd_url: '',
      mp4_sd_url: 'https://f.video.weibocdn.com/o0/sd.mp4',
    }))
    expect(sd.media[0].videoUrl).toBe('https://f.video.weibocdn.com/o0/sd.mp4')
  })

  it('walks the videoUrl chain mp4_hd → mp4_sd → stream_url_hd → stream_url, dropping unplayable videos', () => {
    const cases: Array<{ mediaInfo: Record<string, unknown>, expected: string | undefined }> = [
      {
        mediaInfo: { mp4_hd_url: 'hd', mp4_sd_url: 'sd', stream_url_hd: 'sh', stream_url: 's' },
        expected: 'hd',
      },
      {
        mediaInfo: { mp4_hd_url: '', mp4_sd_url: 'sd', stream_url_hd: 'sh', stream_url: 's' },
        expected: 'sd',
      },
      {
        mediaInfo: { mp4_hd_url: '', mp4_sd_url: '', stream_url_hd: 'sh', stream_url: 's' },
        expected: 'sh',
      },
      {
        mediaInfo: { mp4_hd_url: '', mp4_sd_url: '', stream_url_hd: '', stream_url: 's' },
        expected: 's',
      },
      // 全链路为空：视频不可播放，normalize 直接丢弃该 media（不产出空 videoUrl 的条目）
      {
        mediaInfo: { mp4_hd_url: '', mp4_sd_url: '', stream_url_hd: '', stream_url: '' },
        expected: undefined,
      },
    ]

    for (const { mediaInfo, expected } of cases) {
      const media = normalizeTweet(makeVideoRaw(mediaInfo)).media
      if (expected === undefined) {
        expect(media).toEqual([])
        continue
      }
      expect(media).toHaveLength(1)
      expect(media[0].type).toBe(MediaType.VIDEO)
      expect(media[0].videoUrl).toBe(expected)
    }
  })
})

/** 地理变种的最小 raw：geo 为 `{ type: 'Point', coordinates: [a, b], detail? }`。 */
function makeGeoRaw(geo: unknown, tags?: unknown[]): RawTweet {
  const overrides: Record<string, unknown> = { geo }
  if (tags)
    overrides.tag_struct = tags
  return makeRawTweet(overrides)
}

describe('variant 2: geo (coordinates + place name)', () => {
  it('swaps real-fixture [lat, lon] coordinates to { latitude, longitude } and resolves the place name', async () => {
    const raw = (await loadFixture('tweet_QqsYymYOS.json')) as any
    const [lat, lon] = raw.geo.coordinates
    // 真实抓包顺序为 [纬度, 经度]：首个分量 <= 90、第二个 > 90 → normalize 需交换
    expect(Math.abs(lat)).toBeLessThanOrEqual(90)
    expect(Math.abs(lon)).toBeGreaterThan(90)
    expect(raw.tag_struct.find((t: any) => t.otype === 'place')).toBeDefined()

    const tweet = normalizeTweet(raw)

    expect(tweet.geo).toEqual({
      latitude: lat,
      longitude: lon,
      address: raw.tag_struct.find((t: any) => t.otype === 'place').tag_name,
    })
  })

  it('accepts [lon, lat] order unchanged and prefers tag_struct place over geo.detail.title (inline fixture)', () => {
    const tweet = normalizeTweet(makeGeoRaw(
      { type: 'Point', coordinates: [113.915406, 22.470616], detail: { title: '深圳湾公园' } },
      [{ otype: 'place', tag_name: '深圳市南山区' }],
    ))

    expect(tweet.geo).toEqual({
      latitude: 22.470616, // 未交换：经度在前
      longitude: 113.915406,
      address: '深圳市南山区', // tag_struct(place) 优先于 geo.detail.title
    })
  })

  it('falls back to geo.detail.title when tag_struct has no place tag (inline fixture)', () => {
    const tweet = normalizeTweet(makeGeoRaw(
      { type: 'Point', coordinates: [113.915406, 22.470616], detail: { title: '深圳湾公园' } },
      [{ otype: 'location', tag_name: '不是 place 标签' }],
    ))

    expect(tweet.geo).toEqual({ latitude: 22.470616, longitude: 113.915406, address: '深圳湾公园' })
  })

  it('omits geo when coordinates are absent, and defaults address to an empty string', () => {
    // geo 为字符串（schema 允许）→ 不是 record，视为无定位
    expect(normalizeTweet(makeGeoRaw('深圳市南山区')).geo).toBeUndefined()
    // 无 detail / 无 place tag → address 为空串（契约仍是必填 string）
    expect(normalizeTweet(makeGeoRaw({ type: 'Point', coordinates: [113.91, 22.47] })).geo)
      .toEqual({ latitude: 22.47, longitude: 113.91, address: '' })
    // 坐标不足两项 → 无定位
    expect(normalizeTweet(makeGeoRaw({ type: 'Point', coordinates: [22.47] })).geo).toBeUndefined()
  })
})

/**
 * 长文变种的最小 raw：真实抓包形状（timeline_u1740358225 / mymblog_page1 中的 `isLongText` 条目）。
 * `text` = 截断 HTML（带「全文」链接），`text_raw` = 截断纯文本，`continue_tag` = 全文入口。
 * 注：fixture 脱敏后正文退化为 `<TEXT>`，故此处内联可读正文。
 */
function makeLongTextRaw(overrides: Record<string, unknown> = {}): RawTweet {
  return makeRawTweet({
    mblogid: 'RcbHecsos',
    isLongText: true,
    textLength: 2412,
    text_raw: '写了 2400 字，聊三件事：折叠屏、端侧模型，以及微博长文的渲染。…',
    text: '写了 2400 字，聊三件事：折叠屏、端侧模型，以及微博长文的渲染。…<a href="https://weibo.com/1740358225/RcbHecsos">全文</a>',
    continue_tag: {
      title: '全文',
      pic: 'https://h5.sinaimg.cn/upload/2015/09/25/3/weibo_longtext.png',
      scheme: 'sinaweibo://longtext?mid=5263078581796878',
    },
    ...overrides,
  })
}

describe('variant 3: long-form text (continue_tag / isLongText)', () => {
  it('keeps the truncated raw text (text = text_raw, textHtml = text) and does not map continue_tag', () => {
    const raw = makeLongTextRaw() as any
    const tweet = normalizeTweet(raw)

    expect(tweet.text).toBe(raw.text_raw)
    expect(tweet.textHtml).toBe(raw.text)
    // 正文仍是截断态：以「…」结尾且远短于 textLength
    expect(tweet.text.endsWith('…')).toBe(true)
    expect(tweet.text.length).toBeLessThan(raw.textLength)
    // textHtml 保留「全文」链接
    expect(tweet.textHtml).toContain('全文')

    // continue_tag（全文入口）不属于 ITweet v1 契约，normalizeTweet 不解析、不臆造字段：
    // 完整正文需另行请求 /ajax/statuses/longtext（TweetService 的 longtext / enrich 路径）。
    expect(tweet).not.toHaveProperty('continue_tag')
    expect(tweet).not.toHaveProperty('continueTag')
    expect(tweet).not.toHaveProperty('longText')
  })

  it('falls back to empty text when text_raw is missing (textHtml still comes from text)', () => {
    const raw = makeLongTextRaw({ text_raw: undefined }) as any
    const tweet = normalizeTweet(raw)

    expect(tweet.text).toBe('')
    expect(tweet.textHtml).toBe(raw.text)
  })

  it('falls back to empty strings when both text fields are missing', () => {
    const tweet = normalizeTweet(makeLongTextRaw({ text: undefined, text_raw: undefined }))

    expect(tweet.text).toBe('')
    expect(tweet.textHtml).toBe('')
  })

  it('handles the real long-form fixture item (continue_tag present) without altering the text mapping', async () => {
    const response = await loadRawJson('mymblog_page1.json')
    const item = response.data.list.find((t: any) => t.continue_tag != null)
    expect(item).toBeDefined()
    expect(item.isLongText).toBe(true)

    const tweet = normalizeTweet(item)

    expect(tweet.text).toBe(item.text_raw)
    expect(tweet.textHtml).toBe(item.text)
    expect(tweet).not.toHaveProperty('continue_tag')
  })
})

describe('variant 4: ad tweets (isAd)', () => {
  it('normalizes an ad tweet without throwing — exclusion happens in TweetService.filterTweets, not here', async () => {
    const response = await loadRawJson('timeline_u1740358225.json')
    const ad = response.data.list.find((t: any) => t.isAd === true)
    expect(ad).toBeDefined()

    // 广告在 raw 层仍是合法微博（isRawTweet 为 true），所以模型层无法也不应「识别」广告；
    // 广告过滤由 TweetService 的私有 filterTweets 负责：
    //   isRawTweet(item) && !(item as { isAd?: unknown }).isAd
    // ArchiveService 不重复实现过滤，它只消费 TweetService 已过滤的列表。
    expect(isRawTweet(ad)).toBe(true)

    const tweet = normalizeTweet(ad)
    expect(tweet.id).toBeTruthy()
    expect(tweet.mblogId).toBe(ad.mblogid)
    expect(tweet.user.name).toBeTruthy()
    expect(typeof tweet.text).toBe('string')
    expect(tweet.stats.likes).toBeGreaterThanOrEqual(0)
  })

  it('drops ads through the public listByUserId path (offline fake axios, private filterTweets runs there)', async () => {
    const response = await loadRawJson('timeline_u1740358225.json')
    const adMblogIds: string[] = response.data.list
      .filter((t: any) => t.isAd === true)
      .map((t: any) => t.mblogid)
    expect(adMblogIds.length).toBeGreaterThan(0)

    const { client } = createFakeAxios(async () => response)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )

    const page = await service.listByUserId('1740358225')
    const keptMblogIds = page.tweets.map(t => t.mblogId)

    // 广告被剔除，其余条目照常归一化
    expect(page.tweets).toHaveLength(response.data.list.length - adMblogIds.length)
    for (const adId of adMblogIds)
      expect(keptMblogIds).not.toContain(adId)
    for (const tweet of page.tweets) {
      expect(tweet.mblogId).toBeTruthy()
      expect(tweet.user.name).toBeTruthy()
    }
  })
})

describe('optional metadata fields (v1 additions)', () => {
  it('extracts readCount / title / isOriginal / sourceUrl from a real mymblog item', async () => {
    const raw = await loadRawJson('mymblog_page1.json')
    const tweet = normalizeTweet(raw.data.list[0])

    expect(tweet.readCount).toBe(117)
    expect(tweet.title).toBe('公开')
    expect(tweet.isOriginal).toBe(true)
    expect(tweet.sourceUrl).toBe(`https://weibo.com/${tweet.user.id}/${tweet.mblogId}`)
  })

  it('extracts topics and linkCards from a real feed item', async () => {
    const raw = await loadRawJson('feed_home.json')
    const item = raw.statuses.find((t: any) => t.url_struct?.length && t.topic_struct?.length)
    expect(item).toBeTruthy()

    const tweet = normalizeTweet(item)

    expect(tweet.topics).toEqual(['科普好视频', '那些被误解的小动物们'])
    expect(tweet.linkCards).toHaveLength(2)
    expect(tweet.linkCards?.[0]).toEqual(expect.objectContaining({
      title: '画渣花小烙的微博视频',
      url: expect.any(String),
    }))
    expect(tweet.linkCards?.[1].title).toBe('画渣花小烙超话')
  })

  it('extracts editCount and topics from a real favorite item', async () => {
    const raw = await loadRawJson('favorites_p1.json')
    const item = raw.data.status.find((t: any) => typeof t.edit_count === 'number')
    expect(item).toBeTruthy()

    const tweet = normalizeTweet(item)

    expect(tweet.editCount).toBe(2)
    expect(tweet.topics).toContain('DeepSeek不打卡也不加班')
  })

  it('extracts the title text and ignores retweets for isOriginal', async () => {
    const likes = await loadRawJson('likes_p1.json')
    const titled = likes.data.list.find((t: any) => t.title?.text)
    expect(normalizeTweet(titled).title).toBe('仅自己可见')

    const search = await loadRawJson('searchProfile_p1.json')
    const retweet = search.data.list.find((t: any) => t.retweeted_status)
    const tweet = normalizeTweet(retweet)
    expect(tweet.isOriginal).toBe(false)
    expect(tweet.readCount).toBe(172)
    expect(tweet.topics).toContain('渡濑结月')
  })

  it('extracts permanentVideoUrl from page_info.media_info (waterfall)', async () => {
    const raw = await loadRawJson('waterfall_p1.json')
    const item = raw.data.list[0]

    const tweet = normalizeTweet(item)

    expect(tweet.permanentVideoUrl).toBe(item.page_info.media_info.h5_url)
    expect(tweet.isOriginal).toBe(true)
  })
})
