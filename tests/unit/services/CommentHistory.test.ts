import { readFile } from 'node:fs/promises'
import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { TelemetryCollector } from 'tests/testkit/telemetryCollector'
import { describe, expect, it } from 'vitest'
import { normalizeComment } from '~/models/data/Tweet'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { myCommentsSpec } from '~/services/endpoints/commentHistory'
import { CommentHistoryService } from '~/services/public/CommentHistoryService'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const fixtureCache = new Map<string, any>()

async function loadFixture(name: string): Promise<any> {
  const cached = fixtureCache.get(name)
  if (cached)
    return cached
  const url = new URL(`../../fixtures/raw/${name}`, import.meta.url)
  const raw = JSON.parse(await readFile(url, 'utf8'))
  fixtureCache.set(name, raw)
  return raw
}

// ---------------------------------------------------------------------------
// synthetic raw helpers（fixture 已脱敏：所有 id 都是 `<ID>`，不能用于去重/翻页断言）
// ---------------------------------------------------------------------------

function mkUser(id: string, name: string): Record<string, unknown> {
  return { id: Number(id), idstr: id, screen_name: name, avatar_hd: `https://avatar/${id}`, verified: false, verified_type: -1 }
}

function mkComment(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  // 上游 `id` / `rootid` 是 number（zod 会拒绝 NaN），标签 id 放 `idstr` / `mid`
  const numericId = Number(id.replace(/\D/g, '')) || 1
  return {
    id: numericId,
    idstr: id,
    mid: id,
    rootid: numericId,
    rootidstr: id,
    floor_number: 1,
    created_at: 'Mon Oct 20 12:00:00 +0800 2026',
    text: `<b>c${id}</b>`,
    text_raw: `c${id}`,
    source: '来自 微博网页版',
    like_counts: 3,
    liked: false,
    user: mkUser('9', 'me'),
    status: { idstr: '1000', mblogid: 'M1000', text: 'parent', user: mkUser('7', 'author') },
    ...extra,
  }
}

function page(items: Array<Record<string, unknown>>, nextCursor: number | string, total = 100): Record<string, unknown> {
  return {
    ok: 1,
    data: {
      comments: items,
      hasvisible: false,
      previous_cursor: 0,
      next_cursor: nextCursor,
      previous_cursor_str: '0',
      next_cursor_str: String(nextCursor),
      total_number: total,
      interval: 0,
      extend_card: 1,
      messType: 'commentsByMe',
    },
  }
}

function pageOfIds(ids: string[], nextCursor: number | string, total = 100): Record<string, unknown> {
  return page(ids.map(id => mkComment(id)), nextCursor, total)
}

function createService(
  respond: (params: Record<string, unknown>) => unknown,
  telemetry?: TelemetryCollector,
) {
  const requested: Array<Record<string, unknown>> = []
  const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
    const params = (cfg.params ?? {}) as Record<string, unknown>
    requested.push(params)
    return respond(params)
  })
  const service = new CommentHistoryService(
    { cookie: 'SUB=abc' },
    { transport, rateLimitService: new NoopRateLimitService() as any, telemetry },
  )
  return { service, requested, getLastConfig }
}

async function collect<T>(iterator: AsyncIterableIterator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterator)
    out.push(item)
  return out
}

// ---------------------------------------------------------------------------
// 1. fixture safeParse
// ---------------------------------------------------------------------------

describe('myCommentsSpec.schema vs real fixtures', () => {
  it.each(['my_comments_p1.json', 'my_comments_p2.json', 'my_comments_end.json'])(
    'safeParse %s',
    async (name) => {
      const raw = await loadFixture(name)
      const result = myCommentsSpec.schema.safeParse(raw)
      if (!result.success)
        console.error(result.error.issues.slice(0, 5))
      expect(result.success).toBe(true)
    },
  )

  it('page fixtures carry a usable cursor / total', async () => {
    const p1 = (await myCommentsSpec.schema.safeParse(await loadFixture('my_comments_p1.json'))).data!
    const p2 = (await myCommentsSpec.schema.safeParse(await loadFixture('my_comments_p2.json'))).data!

    expect(p1.ok).toBe(1)
    expect(p1.data.comments.length).toBe(20)
    expect(p1.data.next_cursor).toBe(5302173179055029)
    expect(p1.data.total_number).toBe(931)
    expect(p1.data.messType).toBe('commentsByMe')

    expect(p2.data.comments.length).toBe(20)
    expect(p2.data.next_cursor).toBe(5281609475427044)
  })

  it('end fixture is the stop state (comments: [], next_cursor: 0)', async () => {
    const end = (await myCommentsSpec.schema.safeParse(await loadFixture('my_comments_end.json'))).data!

    expect(end.data.comments).toEqual([])
    expect(end.data.next_cursor).toBe(0)
    expect(end.data.total_number).toBe(931)
  })
})

// ---------------------------------------------------------------------------
// 2. normalizeComment
// ---------------------------------------------------------------------------

describe('normalizeComment (D2)', () => {
  it('normalizes a real myCmt comment item (rootId / floorNumber / liked / parentMblogId / replyTo)', async () => {
    const raw = await loadFixture('my_comments_p1.json')
    const item = raw.data.comments.find((c: any) => c.reply_comment) ?? raw.data.comments[0]

    const comment = normalizeComment(item)

    expect(comment.id).toBe(String(item.idstr))
    expect(comment.createdAt).toBe(item.created_at)
    expect(comment.text).toBe(item.text_raw ?? item.text)
    expect(comment.textHtml).toBe(item.text)
    expect(comment.source).toBe(item.source ?? '')
    expect(comment.likes).toBe(item.like_counts ?? 0)
    expect(comment.user.id).toBe(String(item.user.idstr))
    expect(comment.user.name).toBe(item.user.screen_name)

    // D2 新增字段
    expect(comment.rootId).toBe(String(item.rootidstr))
    expect(comment.floorNumber).toBe(item.floor_number)
    expect(comment.liked).toBe(item.liked)
    expect(comment.parentMblogId).toBe(item.status.mblogid)
    // myCmt 的评论项没有 total_number → 省略该字段（不伪造 0）
    expect(comment.totalReplies).toBeUndefined()
    // 首屏 myCmt 项没有 comments 楼中楼列表 → 不产生 replies
    expect(comment.replies).toBeUndefined()

    expect(comment.replyTo).toBeDefined()
    expect(comment.replyTo!.id).toBe(String(item.reply_comment.idstr))
    expect(comment.replyTo!.text).toBe(item.reply_comment.text)
    expect(comment.replyTo!.user.name).toBe(item.reply_comment.user.screen_name)
    expect(comment.replyTo!.floorNumber).toBe(item.reply_comment.floor_number)
    expect(comment.replyTo!.rootId).toBe(String(item.reply_comment.rootidstr ?? item.reply_comment.rootid))
    // 被回复评论没有 like_counts / liked → 默认 0 / 省略
    expect(comment.replyTo!.likes).toBe(0)
    expect(comment.replyTo!.liked).toBeUndefined()
    expect(comment.replyTo!.replyTo).toBeUndefined()
  })

  it('recursively normalizes nested reply_comment', () => {
    const raw = mkComment('5', {
      reply_comment: mkComment('4', { reply_comment: mkComment('3') }),
      total_number: 7,
    })

    const comment = normalizeComment(raw)

    expect(comment.totalReplies).toBe(7)
    expect(comment.replyTo?.id).toBe('4')
    expect(comment.replyTo?.replyTo?.id).toBe('3')
    expect(comment.replyTo?.replyTo?.parentMblogId).toBe('M1000')
    expect(comment.replyTo?.liked).toBe(false)
  })

  it('does not confuse reply_comment with the comments (楼中楼) field', () => {
    const raw = mkComment('5', {
      comments: [mkComment('6'), mkComment('7')],
      reply_comment: mkComment('4', { comments: [mkComment('8')] }),
    })

    const comment = normalizeComment(raw)

    // comments → replies（是谁回复了这条）
    expect(comment.replies?.map(r => r.id)).toEqual(['6', '7'])
    // reply_comment → replyTo（我回复了谁），其自身残留的 comments 不被展开
    expect(comment.replyTo?.id).toBe('4')
    expect(comment.replyTo?.replies).toBeUndefined()
  })

  it('survives missing status / reply_comment / user', () => {
    const comment = normalizeComment({ idstr: '1', text: 'hi' })

    expect(comment.id).toBe('1')
    expect(comment.text).toBe('hi')
    expect(comment.likes).toBe(0)
    expect(comment.user).toEqual({ id: '', name: '', avatar: '', verified: false, verifiedType: 0 })
    expect(comment.parentMblogId).toBeUndefined()
    expect(comment.replyTo).toBeUndefined()
    expect(comment.rootId).toBeUndefined()
    expect(comment.liked).toBeUndefined()
    expect(comment.floorNumber).toBeUndefined()

    // 非对象 / null 也不崩
    expect(normalizeComment(null).id).toBe('')
    expect(normalizeComment(undefined).text).toBe('')
    expect(normalizeComment('oops').createdAt).toBe('')
  })

  it('falls back to numeric rootid and ignores the 0 sentinel', () => {
    expect(normalizeComment({ rootid: 123 }).rootId).toBe('123')
    expect(normalizeComment({ rootid: 0 }).rootId).toBeUndefined()
    expect(normalizeComment({ rootidstr: '', rootid: 456 }).rootId).toBe('456')
    expect(normalizeComment({ floor_number: 0 }).floorNumber).toBe(0)
    expect(normalizeComment({ floor_number: -1 }).floorNumber).toBeUndefined()
    expect(normalizeComment({ liked: true }).liked).toBe(true)
    expect(normalizeComment({ liked: 'true' }).liked).toBeUndefined()
  })

  it('keeps buildComments behavior (text/textHtml/source/likes/replies)', () => {
    const comment = normalizeComment({
      idstr: 'c1',
      created_at: 'Mon Oct 19 12:00:00 +0800 2026',
      text: '<b>hello</b>',
      text_raw: 'hello',
      source: '来自 北京',
      like_counts: 7,
      user: { id: 9, idstr: '9', screen_name: 'commenter' },
      comments: [{ idstr: 'r1', text_raw: 'reply', user: { idstr: '10', screen_name: 'x' } }],
    })

    expect(comment).toMatchObject({
      id: 'c1',
      text: 'hello',
      textHtml: '<b>hello</b>',
      source: '来自 北京',
      likes: 7,
      user: { id: '9', name: 'commenter' },
    })
    expect(comment.replies).toHaveLength(1)
    expect(comment.replies![0].id).toBe('r1')
  })
})

// ---------------------------------------------------------------------------
// 3. CommentHistoryService.listMine
// ---------------------------------------------------------------------------

describe('commentHistoryService.listMine', () => {
  it('first page sends no params and normalizes comments', async () => {
    const { service, requested, getLastConfig } = createService(() => pageOfIds(['A1', 'A2'], 111, 931))

    const result = await service.listMine()

    expect(requested).toEqual([{}])
    expect(getLastConfig()?.method).toBe('GET')
    expect(getLastConfig()?.url).toBe('https://weibo.com/ajax/message/myCmt')
    expect(result.cursor).toBe(111)
    expect(result.hasMore).toBe(true)
    expect(result.total).toBe(931)
    expect(result.comments.map(c => c.id)).toEqual(['A1', 'A2'])
    expect(result.comments[0].parentMblogId).toBe('M1000')
    expect(result.comments[0].rootId).toBe('A1')
    expect(result.comments[0].liked).toBe(false)
  })

  it('second page sends max_id=<previous cursor>', async () => {
    const { service, requested } = createService((params) => {
      if (params.max_id === undefined)
        return pageOfIds(['A1'], 111)
      return pageOfIds(['B1'], 0)
    })

    const first = await service.listMine()
    const second = await service.listMine({ maxId: first.cursor })

    expect(requested).toEqual([{}, { max_id: 111 }])
    expect(second.cursor).toBe(0)
    expect(second.hasMore).toBe(false)
    expect(second.comments.map(c => c.id)).toEqual(['B1'])
  })

  it('converts a numeric string maxId to number (upstream max_id is a number)', async () => {
    const { service, requested } = createService(() => pageOfIds(['B1'], 0))

    await service.listMine({ maxId: '5302173179055029' })

    expect(requested).toEqual([{ max_id: 5302173179055029 }])
    expect(typeof requested[0].max_id).toBe('number')
  })

  it('uses page when maxId is absent, and maxId wins when both are given', async () => {
    const { service, requested } = createService(() => pageOfIds(['A1'], 0))

    await service.listMine({ page: 3 })
    await service.listMine({ maxId: 42, page: 3 })
    await service.listMine({ page: 0 })
    await service.listMine({ maxId: 'not-a-number' })

    expect(requested).toEqual([{ page: 3 }, { max_id: 42 }, {}, {}])
  })

  it('dedupes within a page and drops total when upstream omits it', async () => {
    const response = pageOfIds(['A1', 'A1', 'A2'], 111)
    delete (response.data as Record<string, unknown>).total_number
    const { service } = createService(() => response)

    const result = await service.listMine()

    expect(result.comments.map(c => c.id)).toEqual(['A1', 'A2'])
    expect(result.total).toBeUndefined()
    expect(result.hasMore).toBe(true)
  })

  it('hasMore=false when the cursor is 0 or the page is empty', async () => {
    const zero = createService(() => pageOfIds(['A1'], 0))
    expect((await zero.service.listMine()).hasMore).toBe(false)

    const empty = createService(() => pageOfIds([], 111))
    expect((await empty.service.listMine()).hasMore).toBe(false)
  })

  it('throws WeiboAPINotOkError when ok != 1', async () => {
    const { service } = createService(() => ({ ok: 0, message: 'not logged in' }))

    await expect(service.listMine()).rejects.toBeInstanceOf(WeiboAPINotOkError)
  })

  it('throws UnexpectedAPIResponseError on schema failure', async () => {
    const { service } = createService(() => ({ ok: 1, data: { comments: 'nope' } }))
    await expect(service.listMine()).rejects.toBeInstanceOf(UnexpectedAPIResponseError)

    const html = createService(() => '<html>login</html>')
    await expect(html.service.listMine()).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
  })
})

// ---------------------------------------------------------------------------
// 4. CommentHistoryService.streamMine
// ---------------------------------------------------------------------------

describe('commentHistoryService.streamMine', () => {
  it('follows next_cursor and stops at cursor 0', async () => {
    const { service, requested } = createService((params) => {
      if (params.max_id === undefined)
        return pageOfIds(['A1', 'A2'], 111)
      if (params.max_id === 111)
        return pageOfIds(['B1'], 222)
      return pageOfIds([], 0)
    })

    const comments = await collect(service.streamMine())

    expect(comments.map(c => c.id)).toEqual(['A1', 'A2', 'B1'])
    expect(requested).toEqual([{}, { max_id: 111 }, { max_id: 222 }])
  })

  it('stops immediately when the first page reports cursor 0', async () => {
    const { service, requested } = createService(() => pageOfIds(['A1'], 0))

    const comments = await collect(service.streamMine())

    expect(comments.map(c => c.id)).toEqual(['A1'])
    expect(requested).toHaveLength(1)
  })

  it('stops on an empty page even if the cursor advances', async () => {
    const { service, requested } = createService((params) => {
      if (params.max_id === undefined)
        return pageOfIds(['A1'], 111)
      return pageOfIds([], 222)
    })

    const comments = await collect(service.streamMine())

    expect(comments.map(c => c.id)).toEqual(['A1'])
    expect(requested).toEqual([{}, { max_id: 111 }])
  })

  it('stops when the cursor does not advance', async () => {
    const { service, requested } = createService((params) => {
      if (params.max_id === undefined)
        return pageOfIds(['A1'], 111)
      // 上游卡住同一游标，但页内容换新 → 靠「游标不前进」停止
      return pageOfIds(['A2'], 111)
    })

    const comments = await collect(service.streamMine())

    expect(comments.map(c => c.id)).toEqual(['A1', 'A2'])
    expect(requested).toEqual([{}, { max_id: 111 }])
  })

  it('stops when upstream repeats the whole page', async () => {
    const { service, requested } = createService((params) => {
      if (params.max_id === undefined)
        return pageOfIds(['A1', 'A2'], 111)
      return pageOfIds(['A1', 'A2'], 222)
    })

    const comments = await collect(service.streamMine())

    expect(comments.map(c => c.id)).toEqual(['A1', 'A2'])
    expect(requested).toEqual([{}, { max_id: 111 }])
  })

  it('dedupes partially overlapping pages', async () => {
    const { service } = createService((params) => {
      if (params.max_id === undefined)
        return pageOfIds(['A1', 'A2'], 111)
      return pageOfIds(['A2', 'A3'], 0)
    })

    const comments = await collect(service.streamMine())

    expect(comments.map(c => c.id)).toEqual(['A1', 'A2', 'A3'])
  })

  it('honors maxPages', async () => {
    const { service, requested } = createService((params) => {
      const n = params.max_id === undefined ? 1 : Number(params.max_id)
      return pageOfIds([`A${n}`], n + 1)
    })

    const comments = await collect(service.streamMine({ maxPages: 2 }))

    expect(comments.map(c => c.id)).toEqual(['A1', 'A2'])
    expect(requested).toHaveLength(2)
  })

  it('starts from maxId / page when given', async () => {
    const fromCursor = createService(() => pageOfIds(['A1'], 0))
    await collect(fromCursor.service.streamMine({ maxId: '555' }))
    expect(fromCursor.requested).toEqual([{ max_id: 555 }])

    const fromPage = createService(() => pageOfIds(['A1'], 0))
    await collect(fromPage.service.streamMine({ page: 4 }))
    expect(fromPage.requested).toEqual([{ page: 4 }])
  })

  it('reports progress per page and ignores callback errors', async () => {
    const progress: Array<{ cursor: number, page: number, processed: number, pageSize: number, total?: number }> = []
    const { service } = createService((params) => {
      if (params.max_id === undefined)
        return pageOfIds(['A1', 'A2'], 111)
      return pageOfIds(['A3'], 0)
    })

    const comments = await collect(service.streamMine({
      onProgress: (p) => {
        progress.push(p)
        if (p.page === 1)
          throw new Error('progress callback must not break the stream')
      },
    }))

    expect(comments.map(c => c.id)).toEqual(['A1', 'A2', 'A3'])
    expect(progress).toEqual([
      { cursor: 111, page: 1, processed: 2, pageSize: 2, total: 100 },
      { cursor: 0, page: 2, processed: 3, pageSize: 1, total: 100 },
    ])
  })

  it('emits a normalize_done Wide Event with the produced count', async () => {
    const telemetry = new TelemetryCollector()
    const { service } = createService((params) => {
      if (params.max_id === undefined)
        return pageOfIds(['A1', 'A2'], 111)
      return pageOfIds(['A3'], 0)
    }, telemetry)

    await collect(service.streamMine())

    const events = telemetry.byName('normalize_done')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event_name: 'normalize_done', model: 'Tweet', count: 3 })
    expect((events[0] as { duration_ms?: number }).duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('emits normalize_done from listMine too', async () => {
    const telemetry = new TelemetryCollector()
    const { service } = createService(() => pageOfIds(['A1'], 0), telemetry)

    await service.listMine()

    expect(telemetry.byName('normalize_done')).toHaveLength(1)
  })

  it('propagates page-level errors', async () => {
    const { service } = createService(() => ({ ok: 1, data: { comments: 123 } }))

    await expect(collect(service.streamMine())).rejects.toBeInstanceOf(UnexpectedAPIResponseError)
  })
})
