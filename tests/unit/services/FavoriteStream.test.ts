import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it } from 'vitest'
import { FavoriteService } from '~/services/public/FavoriteService'

interface RawFavorite {
  id: string
  idstr: string
  mblogid: string
  text?: string
  tags?: unknown[]
  [key: string]: unknown
}

function favorite(mblogid: string, extra: Partial<RawFavorite> = {}): RawFavorite {
  return { id: mblogid, idstr: mblogid, mblogid, text: `text-${mblogid}`, ...extra }
}

interface PageOptions {
  total?: number
  totalPage?: number
}

function page(items: RawFavorite[], options: PageOptions = {}): Record<string, unknown> {
  const data: Record<string, unknown> = { status: items }
  if (options.total !== undefined)
    data.total_number = options.total
  const response: Record<string, unknown> = { ok: 1, data }
  if (options.totalPage !== undefined)
    response.total_page = options.totalPage
  return response
}

function createService(responses: Record<number, unknown>, requested: number[] = []) {
  const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
    const pageNo = Number(cfg.params?.page ?? 1)
    requested.push(pageNo)
    return responses[pageNo] ?? page([])
  })
  const service = new FavoriteService(
    { cookie: 'SUB=abc' },
    { transport, rateLimitService: new NoopRateLimitService() as any },
  )
  return { service, getLastConfig }
}

async function collect<T>(iterator: AsyncIterableIterator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterator)
    out.push(item)
  return out
}

describe('favoriteService.listFavorites', () => {
  it('normalizes a page, dedupes within page and reads total_page', async () => {
    const requested: number[] = []
    const { service, getLastConfig } = createService({
      1: page([favorite('A'), favorite('B'), favorite('A')], { total: 40, totalPage: 4 }),
    }, requested)

    const result = await service.listFavorites('111')

    expect(result.tweets.map(tweet => tweet.mblogId)).toEqual(['A', 'B'])
    expect(result.page).toBe(2)
    expect(result.hasMore).toBe(true)
    expect(result.total).toBe(40)
    expect(result.totalPages).toBe(4)
    expect(requested).toEqual([1])
    expect(getLastConfig()?.params).toEqual({ uid: '111', page: 1, with_total: true })
  })

  it('treats page 0 as the first page', async () => {
    const requested: number[] = []
    const { service } = createService({
      1: page([favorite('A')], { totalPage: 1 }),
    }, requested)

    const result = await service.listFavorites('111', { page: 0 })

    expect(result.page).toBe(2)
    expect(result.hasMore).toBe(false)
    expect(requested).toEqual([1])
  })

  it('filters by tag on the client (upstream ignores tag params)', async () => {
    const { service } = createService({
      1: page([
        favorite('A', { tags: [{ tag_name: 'tech' }] }),
        favorite('B', { tags: [{ id: 42 }] }),
        favorite('C'),
      ], { totalPage: 1 }),
    })

    const byName = await service.listFavorites('111', { tag: 'tech' })
    expect(byName.tweets.map(tweet => tweet.mblogId)).toEqual(['A'])

    const byId = await service.listFavorites('111', { tag: 42 })
    expect(byId.tweets.map(tweet => tweet.mblogId)).toEqual(['B'])
  })
})

describe('favoriteService.streamFavorites', () => {
  it('auto-pages and dedupes across pages', async () => {
    const requested: number[] = []
    const { service } = createService({
      1: page([favorite('A'), favorite('B')], { total: 3, totalPage: 2 }),
      2: page([favorite('B'), favorite('C')], { total: 3, totalPage: 2 }),
    }, requested)

    const tweets = await collect(service.streamFavorites('111'))

    expect(tweets.map(tweet => tweet.mblogId)).toEqual(['A', 'B', 'C'])
    expect(requested).toEqual([1, 2])
  })

  it('stops when upstream repeats the whole page', async () => {
    const requested: number[] = []
    const { service } = createService({
      1: page([favorite('A'), favorite('B')], { total: 100 }),
      2: page([favorite('A'), favorite('B')], { total: 100 }),
      3: page([favorite('C')], { total: 100 }),
    }, requested)

    const tweets = await collect(service.streamFavorites('111'))

    expect(tweets.map(tweet => tweet.mblogId)).toEqual(['A', 'B'])
    expect(requested).toEqual([1, 2])
  })

  it('stops on an empty page (empty favorites)', async () => {
    const requested: number[] = []
    const { service } = createService({ 1: page([], { total: 0 }) }, requested)

    const tweets = await collect(service.streamFavorites('111'))

    expect(tweets).toEqual([])
    expect(requested).toEqual([1])
  })

  it('honors maxPages even when upstream reports more pages', async () => {
    const requested: number[] = []
    const { service } = createService({
      1: page([favorite('A')], { total: 100, totalPage: 5 }),
      2: page([favorite('B')], { total: 100, totalPage: 5 }),
      3: page([favorite('C')], { total: 100, totalPage: 5 }),
    }, requested)

    const tweets = await collect(service.streamFavorites('111', { maxPages: 2 }))

    expect(tweets.map(tweet => tweet.mblogId)).toEqual(['A', 'B'])
    expect(requested).toEqual([1, 2])
  })

  it('keeps paging when a whole page is filtered out by tag', async () => {
    const requested: number[] = []
    const { service } = createService({
      1: page([favorite('A')], { totalPage: 2 }),
      2: page([favorite('B', { tags: [{ name: 'tech' }] })], { totalPage: 2 }),
    }, requested)

    const tweets = await collect(service.streamFavorites('111', { tag: 'tech' }))

    expect(tweets.map(tweet => tweet.mblogId)).toEqual(['B'])
    expect(requested).toEqual([1, 2])
  })

  it('reports per-page progress without letting callback errors break the stream', async () => {
    const progress: Array<{ page: number, processed: number, pageSize: number, matched: number, totalPages?: number }> = []
    const { service } = createService({
      1: page([favorite('A'), favorite('B')], { totalPage: 2 }),
      2: page([favorite('C')], { totalPage: 2 }),
    })

    const tweets = await collect(service.streamFavorites('111', {
      tag: 'missing',
      onProgress: (p) => {
        progress.push(p)
        if (p.page === 1)
          throw new Error('progress callback should not break the stream')
      },
    }))

    expect(tweets).toEqual([])
    expect(progress.map(p => ({ page: p.page, processed: p.processed, pageSize: p.pageSize, matched: p.matched, totalPages: p.totalPages }))).toEqual([
      { page: 1, processed: 0, pageSize: 2, matched: 0, totalPages: 2 },
      { page: 2, processed: 0, pageSize: 1, matched: 0, totalPages: 2 },
    ])
  })
})
