import type {
  TweetArticleAttachment,
  TweetAttachment,
  TweetLiveAttachment,
  TweetLotteryAttachment,
  TweetVoteAttachment,
  TweetVoteOption,
} from '~/types/domain/ITweet'

/**
 * 微博附件归一化（纯函数）。
 *
 * 同一对象在 PC 与 m 站的位置不同：
 * - PC：`page_info`（article / hudongvote / live）；
 * - m 站：`url_objects[].object.object`；
 * - 抽奖：`url_struct[]` 的链接卡。
 *
 * 本模块只读 raw、不发请求；`pageInfo` / `linkCards` 仍由 `Tweet.ts` 保留。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string')
    return value.trim() === '' ? undefined : value
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  return undefined
}

function asNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined)
    return undefined
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : undefined
}

function asBool01(value: unknown): boolean | undefined {
  const num = asNumber(value)
  return num === undefined ? undefined : num === 1
}

function stripObjectPrefix(id: string | undefined): string {
  return id?.replace(/^1022:/, '') ?? ''
}

/** 上游图片字段可能是字符串，也可能是 `{ url, width, height }`（m 站 `page_pic`）。 */
function picUrl(value: unknown): string | undefined {
  const url = typeof value === 'string'
    ? asString(value)
    : isRecord(value)
      ? asString(value.url)
      : undefined
  return url?.replace(/^http:\/\//i, 'https://')
}

function queryParam(url: string | undefined, key: string): string | undefined {
  if (!url)
    return undefined
  try {
    return new URL(url).searchParams.get(key) ?? undefined
  }
  catch {
    return undefined
  }
}

function parseJson(value: string | undefined): unknown {
  if (!value)
    return undefined
  try {
    return JSON.parse(value)
  }
  catch {
    return undefined
  }
}

/**
 * 统一的 `page_info` 语义类型。
 *
 * PC：`object_type` 是 `"video"` / `"article"` / `"live"` / `"hudongvote"`；
 * m：`object_type` 可能是数字 `11`，语义在 `type: "video"` / `"live"`。
 */
export function pageObjectType(page: Record<string, unknown>): string {
  const raw = page.object_type
  if (typeof raw === 'string' && raw !== '')
    return raw
  return asString(page.type) ?? asString(raw) ?? ''
}

/** 把 `2026-10-22 10:03:10`（+0800）解析为 unix 秒；失败返回 undefined。 */
function parseCnDate(value: string | undefined): number | undefined {
  if (!value)
    return undefined
  const ms = Date.parse(`${value.replace(' ', 'T')}+08:00`)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

function dedupeAttachments(items: TweetAttachment[]): TweetAttachment[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.kind}:${item.id}`
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

/**
 * 从任意微博 raw 中提取结构化附件。
 *
 * 未知 `object_type` 会被忽略；返回空数组表示没有识别到附件。
 */
export function extractAttachments(raw: unknown): TweetAttachment[] {
  const record = isRecord(raw) ? raw : undefined
  if (!record)
    return []

  const out: TweetAttachment[] = []

  const page = isRecord(record.page_info) ? record.page_info : undefined
  if (page)
    out.push(...fromPageInfo(page, asBool01(record.is_paid)))

  if (Array.isArray(record.url_objects)) {
    for (const item of record.url_objects)
      out.push(...fromUrlObject(item))
  }

  if (Array.isArray(record.url_struct)) {
    for (const item of record.url_struct) {
      const lottery = fromUrlStructLottery(item)
      if (lottery)
        out.push(lottery)
    }
  }

  return dedupeAttachments(out)
}

function fromPageInfo(page: Record<string, unknown>, isPaid: boolean | undefined): TweetAttachment[] {
  switch (pageObjectType(page)) {
    case 'article': {
      const article = normalizeArticleFromPage(page, isPaid)
      return article ? [article] : []
    }
    case 'hudongvote': {
      const vote = normalizeVoteFromPage(page)
      return vote ? [vote] : []
    }
    case 'live': {
      const live = normalizeLiveFromPage(page)
      return live ? [live] : []
    }
    default:
      return []
  }
}

function fromUrlObject(item: unknown): TweetAttachment[] {
  const outer = isRecord(item) ? item : undefined
  const wrapper = outer && isRecord(outer.object) ? outer.object : undefined
  const obj = wrapper && isRecord(wrapper.object) ? wrapper.object : undefined
  if (!obj)
    return []

  switch (asString(obj.object_type)) {
    case 'article': {
      const article = normalizeArticleFromObject(obj)
      return article ? [article] : []
    }
    case 'hudongvote': {
      // vote_dynamic 在外层 url_objects[]（item）上，不在 object 里
      const vote = normalizeVoteFromObject(obj, outer)
      return vote ? [vote] : []
    }
    case 'live': {
      const live = normalizeLiveFromObject(obj)
      return live ? [live] : []
    }
    default:
      return []
  }
}

function normalizeArticleFromPage(
  page: Record<string, unknown>,
  isPaid: boolean | undefined,
): TweetArticleAttachment | undefined {
  const pageId = asString(page.page_id)
  const objectId = stripObjectPrefix(asString(page.object_id))
  const id = objectId || pageId
  if (!id)
    return undefined

  const scheme = asString(page.page_url)
  // URLSearchParams 已经解码，不要再 decodeURIComponent 一次
  const webUrl = queryParam(scheme, 'url')
    ?? `https://weibo.com/ttarticle/p/show?id=${encodeURIComponent(pageId ?? id)}`

  const transition = Array.isArray(page.transition_pics) ? page.transition_pics : []
  const firstTransition = isRecord(transition[0])
    ? isRecord(transition[0].pic_big) ? transition[0].pic_big : undefined
    : undefined
  const user = isRecord(page.user) ? page.user : undefined

  return {
    kind: 'article',
    id,
    objectType: 'article',
    source: 'page_info',
    title: asString(page.content1) ?? asString(page.page_title) ?? '',
    summary: asString(page.page_desc) || asString(page.content2),
    author: asString(page.content3) ?? asString(user?.screen_name),
    coverUrl: picUrl(page.page_pic) ?? picUrl(firstTransition),
    url: webUrl,
    isPaid,
  }
}

function normalizeArticleFromObject(obj: Record<string, unknown>): TweetArticleAttachment | undefined {
  const id = stripObjectPrefix(asString(obj.id))
  if (!id)
    return undefined

  const author = isRecord(obj.author) ? obj.author : undefined
  return {
    kind: 'article',
    id,
    objectType: 'article',
    source: 'url_objects',
    title: asString(obj.display_name) ?? '',
    summary: asString(obj.article_summary) ?? asString(obj.summary),
    author: asString(author?.display_name),
    coverUrl: picUrl(obj.image),
    url: asString(obj.url) ?? asString(obj.target_url) ?? `https://weibo.com/ttarticle/p/show?id=${encodeURIComponent(id)}`,
    isPaid: obj.ispay === true ? true : undefined,
  }
}

function normalizeVoteFromPage(page: Record<string, unknown>): TweetVoteAttachment | undefined {
  const cardInfo = isRecord(page.card_info) ? page.card_info : undefined
  const vote = cardInfo && isRecord(cardInfo.vote_object) ? cardInfo.vote_object : undefined
  return vote ? buildVote(vote, undefined, page, 'page_info') : undefined
}

function normalizeVoteFromObject(
  obj: Record<string, unknown>,
  dynamicHolder: Record<string, unknown> | undefined,
): TweetVoteAttachment | undefined {
  const vote = isRecord(obj.vote_object) ? obj.vote_object : undefined
  return vote
    ? buildVote(vote, asString(dynamicHolder?.vote_dynamic), obj, 'url_objects')
    : undefined
}

function buildVote(
  vote: Record<string, unknown>,
  dynamicRaw: string | undefined,
  sourceRecord: Record<string, unknown>,
  source: 'page_info' | 'url_objects',
): TweetVoteAttachment | undefined {
  // m 站：vote_object 的票数可能是 0，以 vote_dynamic 为准
  const parsedDynamic = parseJson(dynamicRaw)
  const dynamic = isRecord(parsedDynamic) ? parsedDynamic : undefined

  // vote_dynamic 也可能带 object_id；vote_object 缺 id 时用它兜底
  const id = stripObjectPrefix(
    asString(vote.object_id)
    ?? asString(dynamic?.object_id)
    ?? asString(sourceRecord.page_id)
    ?? asString(vote.id),
  )
  if (!id)
    return undefined
  const dynamicById = new Map<string, Record<string, unknown>>()
  if (dynamic && Array.isArray(dynamic.vote_list)) {
    for (const item of dynamic.vote_list) {
      if (!isRecord(item))
        continue
      const optionId = asString(item.id)
      if (optionId)
        dynamicById.set(optionId, item)
    }
  }

  const options: TweetVoteOption[] = []
  if (Array.isArray(vote.vote_list)) {
    for (const item of vote.vote_list) {
      if (!isRecord(item))
        continue
      const optionId = asString(item.id)
      if (!optionId)
        continue
      const current = dynamicById.get(optionId)
      options.push({
        id: optionId,
        text: asString(item.content) ?? '',
        votes: asNumber(current?.part_num) ?? asNumber(item.part_num),
        ratio: asNumber(current?.part_ratio) ?? asNumber(item.part_ratio),
        selected: asBool01(current?.selected ?? item.selected),
        imageUrl: picUrl(item.pic),
      })
    }
  }

  return {
    kind: 'vote',
    id,
    objectType: 'hudongvote',
    source,
    title: asString(vote.content) ?? '',
    url: asString(vote.target_url) ?? asString(sourceRecord.page_url) ?? asString(sourceRecord.url) ?? '',
    coverUrl: picUrl(sourceRecord.page_pic),
    multiSelect: asBool01(vote.is_multi_select) ?? false,
    minChoices: asNumber(vote.minimum),
    maxChoices: asNumber(vote.maximum),
    expiresAt: asNumber(vote.expire_date),
    totalVotes: asNumber(dynamic?.part_info) ?? asNumber(vote.part_info),
    state: asNumber(vote.state),
    options,
  }
}

function normalizeLiveFromPage(page: Record<string, unknown>): TweetLiveAttachment | undefined {
  const media = isRecord(page.media_info) ? page.media_info : undefined
  const liveId = asString(media?.live_id) ?? stripObjectPrefix(asString(page.object_id))
  if (!liveId)
    return undefined

  const subscribe = media && isRecord(media.subscribe) ? media.subscribe : undefined
  return {
    kind: 'live',
    id: stripObjectPrefix(liveId),
    objectType: 'live',
    source: 'page_info',
    title: asString(page.page_title) ?? asString(page.content1) ?? '',
    url: `https://weibo.com/l/wblive/p/show/${liveId}`,
    coverUrl: picUrl(page.page_pic) ?? picUrl(subscribe?.cover),
    liveId,
    status: asNumber(media?.real_status) ?? asNumber(page.status),
    startedAt: asNumber(media?.live_start_time),
    viewerCount: asNumber(media?.real_chatroom_users),
    replayCount: asNumber(media?.live_replay_counts),
    streamUrl: asString(media?.live_ld) ?? asString(media?.stream_url),
    replayUrl: asString(media?.replay_ld) ?? asString(media?.replay_hd),
    watchLimit: asNumber(page.watch_limit) ?? asNumber(media?.watch_limit),
  }
}

function normalizeLiveFromObject(obj: Record<string, unknown>): TweetLiveAttachment | undefined {
  const liveId = asString(obj.id)
  if (!liveId)
    return undefined

  const urls = isRecord(obj.urls) ? obj.urls : undefined
  const stream = isRecord(obj.stream) ? obj.stream : undefined
  const author = isRecord(obj.author) ? obj.author : undefined

  return {
    kind: 'live',
    id: stripObjectPrefix(liveId),
    objectType: 'live',
    source: 'url_objects',
    title: asString(obj.display_name) ?? '',
    url: asString(obj.url) ?? `https://weibo.com/l/wblive/p/show/${liveId}`,
    coverUrl: picUrl(obj.image),
    liveId,
    status: asNumber(obj.real_status) ?? asNumber(obj.status),
    startedAt: parseCnDate(asString(obj.stime)),
    durationSeconds: asNumber(obj.duration),
    streamUrl: asString(urls?.live_ld) ?? asString(urls?.live_hd) ?? asString(stream?.url),
    replayUrl: asString(urls?.replay_ld) ?? asString(urls?.replay_hd),
    watchLimit: asNumber(obj.watch_limit),
    authorName: asString(author?.display_name),
  }
}

function fromUrlStructLottery(item: unknown): TweetLotteryAttachment | undefined {
  if (!isRecord(item))
    return undefined

  const url = asString(item.h5_target_url)
    ?? asString(item.long_url)
    ?? asString(item.ori_url)
  if (!url || !/^https?:\/\/lottery\.media\.weibo\.com\//i.test(url))
    return undefined

  const mid = queryParam(url, 'mid') ?? ''
  const id = asString(item.page_id) ?? mid
  if (!id)
    return undefined

  return {
    kind: 'lottery',
    id,
    objectType: 'lottery',
    source: 'url_struct',
    title: asString(item.url_title) ?? '抽奖详情',
    url,
    mid,
    detailUrl: url,
  }
}
