import { readFile } from 'node:fs/promises'
import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { WeiboAPINotOkError, WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { likeListSpec } from '~/services/endpoints/like'
import { LikeService } from '~/services/public/LikeService'

/** 真实端点：GET https://weibo.com/ajax/statuses/likelist?uid=&page= */
const LIKES_URL = 'https://weibo.com/ajax/statuses/likelist'

interface RawLike {
  id: number
  idstr: string
  mid: string
  mblogid: string
  created_at: string
  text: string
  text_raw: string
  source: string
  visible: { type: number, list_id: number }
  user: Record<string, unknown>
  attitudes_count: number
  comments_count: number
  reposts_count: number
  [key: string]: unknown
}

function likeItem(mblogid: string, extra: Record<string, unknown> = {}): RawLike {
  return {
    id: 1,
    idstr: '1',
    mid: `mid-${mblogid}`,
    mblogid,
    created_at: '2024-01-01',
    text: `<a>html-${mblogid}</a>`,
    text_raw: `text-${mblogid}`,
    source: 'iPhone',
    visible: { type: 0, list_id: 0 },
    user: {
      id: 100,
      idstr: '100',
      screen_name: 'author',
      avatar_hd: 'avatar',
      verified: true,
      verified_type: 0,
    },
    attitudes_count: 2,
    comments_count: 3,
    reposts_count: 4,
    ...extra,
  }
}

/** 真实响应形状：{ ok: 1, data: { list: [] } }，无 total / hasMore / cursor。 */
function likesPage(items: RawLike[]): Record<string, unknown> {
  return { ok: 1, data: { list: items } }
}

function createService(
  responses: Record<number, unknown>,
  requested: number[] = [],
) {
  const { client, getLastConfig } = createFakeAxios(async (cfg) => {
    const pageNo = Number(cfg.params?.page ?? 1)
    requested.push(pageNo)
    return responses[pageNo] ?? likesPage([])
  })
  const service = new LikeService(
    { cookie: 'SUB=abc' },
    { client, rateLimitService: new NoopRateLimitService() as any },
  )
  return { service, getLastConfig }
}

async function collect<T>(iterator: AsyncIterableIterator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterator)
    out.push(item)
  return out
}

describe('likes/likelist fixture', () => {
  const files = ['likes_p1.json', 'likes_p2.json', 'likes_end.json'] as const

  it.each(files)('validates real fixture %s against likeListSpec.schema', async (file) => {
    const url = new URL(`../../fixtures/raw/${file}`, import.meta.url)
    const raw = JSON.parse(await readFile(url, 'utf8'))

    const result = likeListSpec.schema.safeParse(raw)
    if (!result.success)
      console.error(result.error.issues.slice(0, 5))
    expect(result.success).toBe(true)
    expect(result.data!.ok).toBe(1)
  })

  it('keeps p1/p2 non-empty and the end page empty', async () => {
    const read = async (file: string) =>
      JSON.parse(await readFile(new URL(`../../fixtures/raw/${file}`, import.meta.url), 'utf8'))

    const p1 = likeListSpec.schema.parse(await read('likes_p1.json'))
    const p2 = likeListSpec.schema.parse(await read('likes_p2.json'))
    const end = likeListSpec.schema.parse(await read('likes_end.json'))

    expect(p1.data.list.length).toBeGreaterThan(0)
    expect(p2.data.list.length).toBeGreaterThan(0)
    // 越界页：200 + 空数组，没有错误码
    expect(end.data.list).toEqual([])
    expect(end.ok).toBe(1)

    // 每页真实条目都带 mblogid（去重键）
    for (const item of p1.data.list)
      expect(typeof item.mblogid).toBe('string')
  })
})

describe('likeService.listByUserId', () => {
  it('calls likelist with uid + page and returns normalized tweets', async () => {
    const requested: number[] = []
    const { service, getLastConfig } = createService({ 1: likesPage([likeItem('A'), likeItem('B')]) }, requested)

    const result = await service.listByUserId('7679065628')

    expect(result.page).toBe(2) // 下一页页码
    expect(result.hasMore).toBe(true)
    expect(result.tweets.map(tweet => tweet.mblogId)).toEqual(['A', 'B'])

    const tweet = result.tweets[0]
    expect(tweet.id).toBe('1')
    expect(tweet.text).toBe('text-A')
    expect(tweet.textHtml).toBe('<a>html-A</a>')
    expect(tweet.user.name).toBe('author')
    expect(tweet.stats).toEqual({ likes: 2, comments: 3, reposts: 4 })

    const cfg = getLastConfig()
    expect(cfg?.url).toBe(LIKES_URL)
    expect(cfg?.method).toBe('GET')
    expect(cfg?.params).toEqual({ uid: '7679065628', page: 1 })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/u/7679065628')
    expect(requested).toEqual([1])
  })

  it('reports hasMore=false on the out-of-range (empty) page', async () => {
    const requested: number[] = []
    const { service } = createService({ 1: likesPage([likeItem('A')]) }, requested)

    const result = await service.listByUserId('111', { page: 2 })

    expect(result).toEqual({ page: 3, hasMore: false, tweets: [] })
    expect(requested).toEqual([2])
  })

  it('dedupes within a page by mblogid', async () => {
    const { service } = createService({
      1: likesPage([likeItem('A'), likeItem('B'), likeItem('A'), likeItem('B', { text_raw: 'dup' })]),
    })

    const result = await service.listByUserId('111')

    expect(result.tweets.map(tweet => tweet.mblogId)).toEqual(['A', 'B'])
  })

  it.each([
    ['0', 0],
    ['-1', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('treats page=%s as the first page (never sends page=0)', async (_label, page) => {
    const requested: number[] = []
    const { service, getLastConfig } = createService({ 1: likesPage([likeItem('A')]) }, requested)

    const result = await service.listByUserId('111', { page })

    expect(result.page).toBe(2)
    expect(requested).toEqual([1])
    expect(getLastConfig()?.params).toEqual({ uid: '111', page: 1 })
  })

  it('throws WeiboAPINotOkError for generic ok !== 1', async () => {
    const { service } = createService({ 1: { ok: 0, message: 'operation failed' } })

    await expect(service.listByUserId('111')).rejects.toBeInstanceOf(WeiboAPINotOkError)
  })

  it('maps login-required ok !== 1 to WeiboSessionExpiredError', async () => {
    const { service } = createService({ 1: { ok: 0, message: 'need login' } })

    await expect(service.listByUserId('111')).rejects.toBeInstanceOf(WeiboSessionExpiredError)
  })

  it('throws UnexpectedAPIResponseError when the payload fails schema validation', async () => {
    // 缺 mblogid 的条目无法归一化
    const { service } = createService({ 1: { ok: 1, data: { list: [{ text: 'no mblogid' }] } } })

    await expect(service.listByUserId('111')).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
  })
})

describe('likeService.streamByUserId', () => {
  it('auto-pages and dedupes across pages', async () => {
    const requested: number[] = []
    const { service } = createService({
      1: likesPage([likeItem('A'), likeItem('B')]),
      2: likesPage([likeItem('B'), likeItem('C')]),
    }, requested)

    const tweets = await collect(service.streamByUserId('111'))

    expect(tweets.map(tweet => tweet.mblogId)).toEqual(['A', 'B', 'C'])
    // 上游没有 hasMore，只能靠「下一页是空页」确认到底（多一次空页请求）
    expect(requested).toEqual([1, 2, 3])
  })

  it('stops on an empty page', async () => {
    const requested: number[] = []
    const { service } = createService({
      1: likesPage([likeItem('A')]),
      2: likesPage([]),
      3: likesPage([likeItem('C')]),
    }, requested)

    const tweets = await collect(service.streamByUserId('111'))

    expect(tweets.map(tweet => tweet.mblogId)).toEqual(['A'])
    expect(requested).toEqual([1, 2])
  })

  it('stops when upstream repeats the whole page (page ignored)', async () => {
    const requested: number[] = []
    const { service } = createService({
      1: likesPage([likeItem('A'), likeItem('B')]),
      2: likesPage([likeItem('A'), likeItem('B')]),
      3: likesPage([likeItem('C')]),
    }, requested)

    const tweets = await collect(service.streamByUserId('111'))

    expect(tweets.map(tweet => tweet.mblogId)).toEqual(['A', 'B'])
    expect(requested).toEqual([1, 2])
  })

  it('honors maxPages', async () => {
    const requested: number[] = []
    const { service } = createService({
      1: likesPage([likeItem('A')]),
      2: likesPage([likeItem('B')]),
      3: likesPage([likeItem('C')]),
    }, requested)

    const tweets = await collect(service.streamByUserId('111', { maxPages: 2 }))

    expect(tweets.map(tweet => tweet.mblogId)).toEqual(['A', 'B'])
    expect(requested).toEqual([1, 2])
  })

  it('starts from the requested page and normalizes illegal page values', async () => {
    const requested: number[] = []
    const { service } = createService({
      1: likesPage([likeItem('A')]),
      2: likesPage([likeItem('B')]),
    }, requested)

    const fromTwo = await collect(service.streamByUserId('111', { page: 2 }))
    expect(fromTwo.map(tweet => tweet.mblogId)).toEqual(['B'])

    const fromZero = await collect(service.streamByUserId('111', { page: 0 }))
    expect(fromZero.map(tweet => tweet.mblogId)).toEqual(['A', 'B'])

    expect(requested).toEqual([2, 3, 1, 2, 3])
  })

  it('reports per-page progress without letting callback errors break the stream', async () => {
    const progress: Array<{ uid: string, page: number, processed: number, pageSize: number }> = []
    const { service } = createService({
      1: likesPage([likeItem('A'), likeItem('B')]),
      2: likesPage([likeItem('B'), likeItem('C')]),
    })

    const tweets = await collect(service.streamByUserId('111', {
      onProgress: (p) => {
        progress.push(p)
        if (p.page === 1)
          throw new Error('progress callback must not break the stream')
      },
    }))

    expect(tweets.map(tweet => tweet.mblogId)).toEqual(['A', 'B', 'C'])
    expect(progress).toEqual([
      { uid: '111', page: 1, processed: 2, pageSize: 2 },
      { uid: '111', page: 2, processed: 3, pageSize: 2 },
    ])
  })

  it('supports an async onProgress callback', async () => {
    const pages: number[] = []
    const { service } = createService({
      1: likesPage([likeItem('A')]),
      2: likesPage([]),
    })

    const tweets = await collect(service.streamByUserId('111', {
      onProgress: async (p) => {
        await Promise.resolve()
        pages.push(p.page)
      },
    }))

    expect(tweets.map(tweet => tweet.mblogId)).toEqual(['A'])
    // 空页不产出，也不触发进度回调（停止条件先判定）
    expect(pages).toEqual([1])
  })

  it('propagates request errors mid-stream', async () => {
    const { service } = createService({
      1: likesPage([likeItem('A')]),
      2: { ok: 0, message: 'boom' },
    })

    const iterator = service.streamByUserId('111')
    await expect(collect(iterator)).rejects.toBeInstanceOf(WeiboAPINotOkError)
  })
})
