import type { TweetLiker } from '~/types/domain/ILiker'
import type { ITweet, ITweetComment, TweetAtUser, TweetAudio, TweetCommentPic, TweetGeo, TweetLinkCard, TweetMedia, TweetPageCard, TweetRepostEntry, TweetUser } from '~/types/domain/ITweet'
import type { VerificationType } from '~/types/domain/IUser'
import type { MyMBLog } from '~/types/raw/tweet/mymblog'
import type { IStatusShowResponse } from '~/types/raw/tweet/show'
import { MediaType, TweetVisible } from '~/types/domain/ITweet'

export type RawTweet = MyMBLog | NonNullable<MyMBLog['retweeted_status']> | IStatusShowResponse | NonNullable<IStatusShowResponse['retweeted_status']>
type UnknownRecord = Record<string, unknown>

/**
 * E2 契约卫生：把 `unknown` 收窄为 `RawTweet` 的运行时 guard。
 *
 * 判定标准：非空非数组对象且 `mblogid` 为 string（与 `MyMBlogItemSchema` 必填字段一致）。
 * schema 校验层已保证该字段存在；此 guard 供 `filterTweets` 等处做类型诚实收窄与纵深防御。
 */
export function isRawTweet(value: unknown): value is RawTweet {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  return typeof (value as { mblogid?: unknown }).mblogid === 'string'
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object'
}

/** 微博/评论共用的简版用户归一化。 */
function normalizeUser(raw: unknown): TweetUser {
  const user = isRecord(raw) ? raw : {}
  return {
    id: String(user.idstr || user.id || ''),
    name: String(user.screen_name || ''),
    avatar: String(user.avatar_hd || user.avatar_large || user.profile_image_url || ''),
    verified: !!user.verified,
    verifiedType: (getNumber(user.verified_type) ?? 0) as unknown as VerificationType,
  }
}

/**
 * 把任意 raw 用户对象归一化为简版 `TweetUser`。
 *
 * 供点赞者 / 点赞通知等「只有用户片段」的场景复用；微博与评论内部仍走私有 `normalizeUser`。
 */
export function normalizeTweetUser(raw: unknown): TweetUser {
  return normalizeUser(raw)
}

function getNumber(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : undefined
}

/** 取第一个非空字符串（`number` 转字符串）；空串 / 非法值返回 undefined。 */
function getString(value: unknown): string | undefined {
  if (typeof value === 'string')
    return value.trim().length > 0 ? value : undefined
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  return undefined
}

function isTweetVisible(value: number): value is TweetVisible {
  return value === TweetVisible.PUBLIC
    || value === TweetVisible.PRIVATE
    || value === TweetVisible.FRIENDS
    || value === TweetVisible.FOLLOWERS
    || value === TweetVisible.GROUP
}

function extractPageInfo(rawRecord: UnknownRecord): TweetPageCard | undefined {
  const page = rawRecord.page_info
  if (!page)
    return undefined
  if (!isRecord(page))
    return undefined

  const card: TweetPageCard = {
    pageId: String(page.page_id ?? ''),
    pageTitle: String(page.page_title ?? ''),
    pageUrl: String(page.page_url ?? ''),
    // 封面与媒体图一致：http 统一升级为 https，避免混合内容
    pagePic: String(page.page_pic ?? '').replace(/^http:\/\//i, 'https://'),
    type: getNumber(page.type) ?? 0,
    objectType: String(page.object_type ?? ''),
  }

  const objectId = getString(page.object_id)
  if (objectId)
    card.objectId = objectId
  const subtitle = getString(page.content2)
  if (subtitle)
    card.subtitle = subtitle

  return card
}

function getCoordinates(raw: RawTweet): [number, number] | undefined {
  const geo = (raw as MyMBLog).geo
  if (!isRecord(geo))
    return undefined

  const coordinates = geo.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2)
    return undefined

  const first = getNumber(coordinates[0])
  const second = getNumber(coordinates[1])
  if (first === undefined || second === undefined)
    return undefined

  // 兼容 [lon, lat] 与 [lat, lon] 两种顺序
  if (Math.abs(first) <= 90 && Math.abs(second) > 90)
    return [second, first]

  return [first, second]
}

function getGeoAddress(raw: RawTweet): string | undefined {
  const tags = (raw as MyMBLog).tag_struct
  if (Array.isArray(tags)) {
    const place = tags.find((t) => {
      if (!isRecord(t))
        return false
      return t.otype === 'place'
    })
    const name = isRecord(place) ? place.tag_name : undefined
    if (typeof name === 'string' && name.length > 0)
      return name
  }

  const geo = (raw as MyMBLog).geo
  if (!isRecord(geo))
    return undefined

  const detail = geo.detail
  if (!isRecord(detail))
    return undefined

  const title = detail.title
  return typeof title === 'string' ? title : undefined
}

function extractGeo(raw: RawTweet): TweetGeo | undefined {
  const coords = getCoordinates(raw)
  if (!coords)
    return undefined

  const [longitude, latitude] = coords
  const address = getGeoAddress(raw) || ''

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    return undefined

  return {
    latitude,
    longitude,
    address,
  }
}

function extractMediaFromMixMediaInfo(rawRecord: UnknownRecord): TweetMedia[] {
  const mix = rawRecord.mix_media_info
  if (!isRecord(mix) || !Array.isArray(mix.items))
    return []

  const out: TweetMedia[] = []
  for (const item of mix.items) {
    if (!isRecord(item))
      continue

    const data = isRecord(item.data) ? item.data : undefined
    const type = typeof item.type === 'string' ? item.type : undefined
    const id = String(item.id || (data && (typeof data.pic_id === 'string' ? data.pic_id : data.object_id)) || '')
    if (!id)
      continue

    if (type === 'pic') {
      const best = data && isRecord(data.largest) ? data.largest
        : data && isRecord(data.original) ? data.original
          : data && isRecord(data.mw2000) ? data.mw2000
            : data && isRecord(data.large) ? data.large
              : data && isRecord(data.bmiddle) ? data.bmiddle
                : data && isRecord(data.thumbnail) ? data.thumbnail
                  : undefined
      const url = best && typeof best.url === 'string' ? best.url : undefined
      if (!url)
        continue

      out.push({
        id,
        type: MediaType.PIC,
        imageUrl: url,
        width: getNumber(best?.width) ?? 0,
        height: getNumber(best?.height) ?? 0,
      })
      continue
    }

    if (type === 'video') {
      const mediaInfo = data && isRecord(data.media_info) ? data.media_info : undefined
      const bigPic = mediaInfo && isRecord(mediaInfo.big_pic_info) && isRecord(mediaInfo.big_pic_info.pic_big) ? mediaInfo.big_pic_info.pic_big : undefined
      const cover = data && isRecord(data.largecover) ? data.largecover
        : data && isRecord(data.largest) ? data.largest
          : bigPic
      const coverUrl = cover && typeof cover.url === 'string' ? cover.url : undefined
      const videoUrl = mediaInfo && typeof mediaInfo.mp4_hd_url === 'string' && mediaInfo.mp4_hd_url
        ? mediaInfo.mp4_hd_url
        : mediaInfo && typeof mediaInfo.mp4_sd_url === 'string' && mediaInfo.mp4_sd_url
          ? mediaInfo.mp4_sd_url
          : mediaInfo && typeof mediaInfo.stream_url_hd === 'string' && mediaInfo.stream_url_hd
            ? mediaInfo.stream_url_hd
            : mediaInfo && typeof mediaInfo.stream_url === 'string'
              ? mediaInfo.stream_url
              : undefined
      if (!coverUrl || !videoUrl)
        continue

      out.push({
        id,
        type: MediaType.VIDEO,
        imageUrl: coverUrl,
        videoUrl,
        duration: mediaInfo ? getNumber(mediaInfo.duration) : undefined,
        width: getNumber(cover?.width) ?? 0,
        height: getNumber(cover?.height) ?? 0,
      })
    }
  }

  return out
}

/** 从 `pic_infos[<pid>]` 选最大尺寸（`largest` → `original` → `mw2000` → `large` → …）。 */
function pickPicSize(info: UnknownRecord): UnknownRecord | undefined {
  for (const key of ['largest', 'original', 'mw2000', 'large', 'woriginal', 'bmiddle', 'thumbnail']) {
    const size = info[key]
    if (isRecord(size))
      return size
  }
  return undefined
}

/** 单张图片（`pic_infos` 内层）→ `TweetMedia`；缺 URL 时返回 `undefined`。 */
function mediaFromPicInfo(picId: string, info: UnknownRecord): TweetMedia | undefined {
  const best = pickPicSize(info)
  const url = best ? getString(best.url) : undefined
  if (!url)
    return undefined

  const type = getString(info.type)
  const videoUrl = getString(info.video)
  return {
    id: getString(info.pic_id) ?? picId,
    type: videoUrl ? MediaType.LIVEPHOTO : type === 'gif' ? MediaType.GIF : MediaType.PIC,
    // `url_struct` 的 reppic 直链是 http；统一升级为 https（同一资源，避免混合内容）
    imageUrl: url.replace(/^http:\/\//i, 'https://'),
    videoUrl,
    width: getNumber(best?.width) ?? 0,
    height: getNumber(best?.height) ?? 0,
  }
}

function extractMediaFromPicInfos(raw: RawTweet): TweetMedia[] {
  const picInfos = raw.pic_infos
  const picIds = raw.pic_ids
  if (!picInfos || !picIds || !Array.isArray(picIds))
    return []

  const out: TweetMedia[] = []
  for (const picId of picIds) {
    if (!isRecord(picInfos))
      return []

    const info = picInfos[picId]
    if (!isRecord(info))
      continue

    const media = mediaFromPicInfo(picId, info)
    if (media)
      out.push(media)
  }

  return out
}

function extractMediaFromPageInfo(rawRecord: UnknownRecord): TweetMedia[] {
  const page = rawRecord.page_info
  if (!isRecord(page))
    return []

  const mediaInfo = isRecord(page.media_info) ? page.media_info : undefined
  if (!mediaInfo)
    return []

  const mediaType = typeof mediaInfo.media_type === 'string'
    ? mediaInfo.media_type
    : typeof page.object_type === 'string'
      ? page.object_type
      : undefined
  if (mediaType !== 'video')
    return []

  const bigPic = isRecord(mediaInfo.big_pic_info) && isRecord(mediaInfo.big_pic_info.pic_big)
    ? mediaInfo.big_pic_info.pic_big
    : undefined
  const coverUrl = typeof page.page_pic === 'string' && page.page_pic.length > 0
    ? page.page_pic
    : bigPic && typeof bigPic.url === 'string' && bigPic.url.length > 0
      ? bigPic.url
      : undefined
  const videoUrl = [mediaInfo.mp4_hd_url, mediaInfo.stream_url_hd, mediaInfo.stream_url, mediaInfo.mp4_sd_url]
    .find(value => typeof value === 'string' && value.length > 0) as string | undefined
  if (!coverUrl || !videoUrl)
    return []

  const id = String(mediaInfo.media_id || page.page_id || page.object_id || '')
  if (!id)
    return []

  return [{
    id,
    type: MediaType.VIDEO,
    imageUrl: coverUrl,
    videoUrl,
    duration: getNumber(mediaInfo.duration),
    width: getNumber(bigPic?.width) ?? 0,
    height: getNumber(bigPic?.height) ?? 0,
  }]
}

function extractMedia(raw: RawTweet, rawRecord: UnknownRecord): TweetMedia[] {
  const fromMix = extractMediaFromMixMediaInfo(rawRecord)
  if (fromMix.length > 0)
    return fromMix

  // 视频瀑布 / 部分详情页把视频放在 page_info.media_info（而不是 mix_media_info）
  const fromPage = extractMediaFromPageInfo(rawRecord)
  if (fromPage.length > 0)
    return fromPage

  return extractMediaFromPicInfos(raw)
}

/** 话题：`topic_struct[].topic_title`（缺省退回 `title`），去重保序。 */
function extractTopics(rawRecord: UnknownRecord): string[] | undefined {
  const list = rawRecord.topic_struct
  if (!Array.isArray(list))
    return undefined

  const out: string[] = []
  for (const item of list) {
    if (!isRecord(item))
      continue
    const title = getString(item.topic_title) ?? getString(item.title)
    if (title && !out.includes(title))
      out.push(title)
  }
  return out.length > 0 ? out : undefined
}

/** 链接 / 超话卡片：`url_struct[]` → `TweetLinkCard[]`（标题与 URL 都缺失时跳过）。 */
function extractLinkCards(rawRecord: UnknownRecord): TweetLinkCard[] | undefined {
  const list = rawRecord.url_struct
  if (!Array.isArray(list))
    return undefined

  const out: TweetLinkCard[] = []
  for (const item of list) {
    if (!isRecord(item))
      continue
    const title = getString(item.url_title)
    const url = getString(item.h5_target_url) ?? getString(item.long_url) ?? getString(item.ori_url)
    if (!title && !url)
      continue

    const card: TweetLinkCard = { title: title ?? '', url: url ?? '' }
    const shortUrl = getString(item.short_url)
    if (shortUrl)
      card.shortUrl = shortUrl
    const pageId = getString(item.page_id)
    if (pageId)
      card.pageId = pageId
    const objectType = getString(item.object_type)
    if (objectType)
      card.objectType = objectType
    const typePic = getString(item.url_type_pic)
    if (typePic)
      card.typePic = typePic
    const longUrl = getString(item.long_url)
    if (longUrl)
      card.longUrl = longUrl
    const oriUrl = getString(item.ori_url)
    if (oriUrl)
      card.oriUrl = oriUrl
    const urlType = getNumber(item.url_type)
    if (urlType !== undefined)
      card.urlType = urlType
    out.push(card)
  }
  return out.length > 0 ? out : undefined
}

/** 正文里的图片短链（`http://t.cn/XXXX`）。 */
const SHORT_URL_RE = /https?:\/\/t\.cn\/[A-Za-z0-9]+/g

/** 短链归一化键：只比较 `t.cn/<code>`，兼容 http/https。 */
function shortUrlKey(value: string | undefined): string | undefined {
  if (!value)
    return undefined
  const match = value.match(/t\.cn\/([A-Za-z0-9]+)/)
  return match ? match[1] : value
}

interface ParsedRepostLevel {
  authorName?: string
  text: string
  shortUrls: string[]
}

/**
 * 把拍平的转发链正文（`//@name:正文 //@name:正文`）切成层级。
 *
 * 第 0 段是当前微博正文；后续每段以 `//@` 开头，作者名到第一个 `:` 为止。
 * 段内的 `t.cn` 短链单独收集，用于和 `url_struct[].short_url` 配对。
 */
function parseRepostText(rawText: string): ParsedRepostLevel[] {
  const chunks = rawText.split('//@')
  const levels: ParsedRepostLevel[] = []

  for (let index = 0; index < chunks.length; index += 1) {
    let body = chunks[index] ?? ''
    let authorName: string | undefined

    if (index > 0) {
      const separator = body.indexOf(':')
      if (separator >= 0) {
        authorName = decodeHtmlText(body.slice(0, separator)).replace(/^@/, '') || undefined
        body = body.slice(separator + 1)
      }
    }

    const shortUrls = body.match(SHORT_URL_RE) ?? []
    levels.push({
      ...(authorName ? { authorName } : {}),
      text: body.replace(SHORT_URL_RE, '').replace(/\u200B/g, '').trim(),
      shortUrls,
    })
  }

  return levels
}

/**
 * 转发链分层 + 层内配图（2026-10-20）。
 *
 * 只对转发微博产出；正文没有 `//@` 且没有 reppic 配图的单层转发不返回（避免噪音）。
 * 图片按 `pic_id` 去重（上游会重复下发）；无法在正文中定位的图片追加到末尾补充层。
 */
function extractRepostChain(rawRecord: UnknownRecord): TweetRepostEntry[] | undefined {
  const hasRetweet = isRecord(rawRecord.retweeted_status)
  if (!hasRetweet && (rawRecord.repost_type === undefined || rawRecord.repost_type === null))
    return undefined

  // `text_raw` 通常就在；退回 HTML 时先去标签，`//<a>@name</a>:` 才会还原成 `//@name:`
  const rawText = getString(rawRecord.text_raw) ?? decodeHtmlText(getString(rawRecord.text) ?? '')
  const levels = parseRepostText(rawText)
  const user = normalizeUser(rawRecord.user)

  const entries: TweetRepostEntry[] = levels.map((level, index) => {
    const entry: TweetRepostEntry = {
      index,
      text: level.text,
      media: [],
    }
    if (index === 0 ? user.name.length > 0 : level.authorName !== undefined)
      entry.authorName = index === 0 ? user.name : level.authorName
    return entry
  })

  const urlStruct = rawRecord.url_struct
  const seenPics = new Set<string>()
  const unmatched: TweetMedia[] = []

  if (Array.isArray(urlStruct)) {
    for (const item of urlStruct) {
      if (!isRecord(item))
        continue

      const picInfos = isRecord(item.pic_infos) ? item.pic_infos : undefined
      const picIds = Array.isArray(item.pic_ids)
        ? item.pic_ids
        : picInfos
          ? Object.keys(picInfos)
          : []
      const key = shortUrlKey(getString(item.short_url))
      const levelIndex = key
        ? levels.findIndex(level => level.shortUrls.some(url => shortUrlKey(url) === key))
        : -1

      for (const picId of picIds) {
        if (typeof picId !== 'string' || picId.length === 0 || seenPics.has(picId))
          continue
        const info = picInfos?.[picId]
        if (!isRecord(info))
          continue
        const media = mediaFromPicInfo(picId, info)
        if (!media)
          continue
        seenPics.add(picId)
        if (levelIndex >= 0)
          entries[levelIndex]?.media.push(media)
        else
          unmatched.push(media)
      }
    }
  }

  if (unmatched.length > 0) {
    // 正文没有 `//@` 时图片就是当前微博自己的配图；否则无法定位，追加到末尾补充层
    if (entries.length === 1)
      entries[0]?.media.push(...unmatched)
    else
      entries.push({ index: entries.length, text: '', media: unmatched })
  }

  if (entries.length <= 1 && !entries.some(entry => entry.media.length > 0))
    return undefined

  return entries
}

/** 顶栏标题：`title.text`（少数端点直接下发字符串）。 */
function extractTitle(rawRecord: UnknownRecord): string | undefined {
  const title = rawRecord.title
  if (isRecord(title))
    return getString(title.text)
  return getString(title)
}

/** 视频永久播放页：优先 `page_info.media_info.h5_url`，其次 `mix_media_info.items[].data.media_info.h5_url`。 */
function extractPermanentVideoUrl(rawRecord: UnknownRecord): string | undefined {
  const page = isRecord(rawRecord.page_info) ? rawRecord.page_info : undefined
  const pageMedia = page && isRecord(page.media_info) ? page.media_info : undefined
  const fromPage = pageMedia ? getString(pageMedia.h5_url) : undefined
  if (fromPage)
    return fromPage

  const mix = isRecord(rawRecord.mix_media_info) ? rawRecord.mix_media_info : undefined
  if (mix && Array.isArray(mix.items)) {
    for (const item of mix.items) {
      if (!isRecord(item) || !isRecord(item.data))
        continue
      const media = isRecord(item.data.media_info) ? item.data.media_info : undefined
      const h5 = media ? getString(media.h5_url) : undefined
      if (h5)
        return h5
    }
  }
  return undefined
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .trim()
}

/**
 * 从 `text` HTML 的 `<a>` 锚点解析 @ 用户。
 *
 * 真实样本（`feed_home.json`）：
 * `<a href=/n/Touko_Fujimiya usercard="name=@Touko_Fujimiya">@Touko_Fujimiya</a>`
 * 上游没有结构化 `at_users` 字段；这里只保留指向用户主页的锚点（`/n/` 或 `/u/`）。
 */
function extractAtUsers(rawRecord: UnknownRecord): TweetAtUser[] | undefined {
  const html = getString(rawRecord.text)
  if (!html)
    return undefined

  const out: TweetAtUser[] = []
  const seen = new Set<string>()
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (let match = anchorRe.exec(html); match !== null; match = anchorRe.exec(html)) {
    const attrs = match[1] ?? ''
    const inner = match[2] ?? ''
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    if (!hrefMatch)
      continue
    const href = (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '').trim()
    const pathMatch = href.match(/(?:^|\/\/[^/]+)\/(?:n|u)\/([^/?#"'\s]+)/i)
      ?? href.match(/^\/(?:n|u)\/([^/?#"'\s]+)/i)
    if (!pathMatch)
      continue

    let username = pathMatch[1]
    try {
      username = decodeURIComponent(username)
    }
    catch {
      // 非法的百分号编码：保留原样，避免因单个锚点丢弃整条微博
    }
    const name = decodeHtmlText(inner).replace(/^@/, '')
    const key = username || name
    if (!key || seen.has(key))
      continue
    seen.add(key)

    const item: TweetAtUser = { name: name || username }
    if (username)
      item.username = username
    if (href.startsWith('//'))
      item.url = `https:${href}`
    else if (/^https?:/i.test(href))
      item.url = href
    else
      item.url = `https://weibo.com${href.startsWith('/') ? href : `/${href}`}`
    out.push(item)
  }

  return out.length > 0 ? out : undefined
}

/** 视频播放数：只认 `online_users` 明确为「N次观看」的历史播放量，直播在线人数不映射。 */
function extractPlayCount(rawRecord: UnknownRecord): number | undefined {
  const fromMedia = (media: UnknownRecord): number | undefined => {
    const label = getString(media.online_users)
    if (!label || !label.includes('次观看'))
      return undefined
    return getNumber(media.online_users_number)
  }

  const page = isRecord(rawRecord.page_info) ? rawRecord.page_info : undefined
  const pageMedia = page && isRecord(page.media_info) ? page.media_info : undefined
  const fromPage = pageMedia ? fromMedia(pageMedia) : undefined
  if (fromPage !== undefined)
    return fromPage

  const mix = isRecord(rawRecord.mix_media_info) ? rawRecord.mix_media_info : undefined
  if (mix && Array.isArray(mix.items)) {
    for (const item of mix.items) {
      if (!isRecord(item) || !isRecord(item.data))
        continue
      const media = isRecord(item.data.media_info) ? item.data.media_info : undefined
      const count = media ? fromMedia(media) : undefined
      if (count !== undefined)
        return count
    }
  }

  return undefined
}

/** 置顶标记：`isTop === 1/true` 或 `top === 1/true`；非置顶返回 undefined。 */
function extractIsTop(rawRecord: UnknownRecord): boolean | undefined {
  const value = rawRecord.isTop ?? rawRecord.top
  return value === 1 || value === true ? true : undefined
}

/** 单条音频归一化（`page_info` / `mix_media_info.items[].data` 同构）。 */
function normalizeAudio(page: UnknownRecord, media: UnknownRecord): TweetAudio | undefined {
  const objectType = getString(page.object_type)
  const mediaType = getString(media.media_type)
  const pageType = getString(page.type)
  const isAudio = objectType === 'podcast_audio' || mediaType === 'audio' || pageType === '44'
  if (!isAudio)
    return undefined

  const id = getString(media.media_id) ?? getString(page.page_id) ?? getString(page.object_id)
  const url = getString(media.stream_url) ?? getString(media.h5_url)
  if (!id && !url)
    return undefined

  const audio: TweetAudio = {
    id: id ?? '',
    title: getString(page.page_title) ?? getString(media.name) ?? '',
    url: url ?? '',
  }

  const duration = getNumber(media.duration)
  if (duration !== undefined)
    audio.duration = duration
  const pageUrl = getString(media.h5_url)
  if (pageUrl)
    audio.pageUrl = pageUrl
  const author = isRecord(media.author_info) ? media.author_info : undefined
  const authorName = author ? getString(author.screen_name) : undefined
  if (authorName)
    audio.authorName = authorName
  const authorId = author ? getString(author.idstr) ?? getString(author.id) : undefined
  if (authorId)
    audio.authorId = authorId

  return audio
}

/** 音频 / 播客：优先 `page_info`，其次 `mix_media_info.items[].data`。 */
function extractAudio(rawRecord: UnknownRecord): TweetAudio[] | undefined {
  const out: TweetAudio[] = []
  const seen = new Set<string>()

  const page = isRecord(rawRecord.page_info) ? rawRecord.page_info : undefined
  const pageMedia = page && isRecord(page.media_info) ? page.media_info : undefined
  if (page && pageMedia) {
    const audio = normalizeAudio(page, pageMedia)
    if (audio && !seen.has(audio.id || audio.url)) {
      seen.add(audio.id || audio.url)
      out.push(audio)
    }
  }

  const mix = isRecord(rawRecord.mix_media_info) ? rawRecord.mix_media_info : undefined
  if (mix && Array.isArray(mix.items)) {
    for (const item of mix.items) {
      if (!isRecord(item) || !isRecord(item.data))
        continue
      const media = isRecord(item.data.media_info) ? item.data.media_info : undefined
      if (!media)
        continue
      const audio = normalizeAudio(item.data, media)
      if (!audio || seen.has(audio.id || audio.url))
        continue
      seen.add(audio.id || audio.url)
      out.push(audio)
    }
  }

  return out.length > 0 ? out : undefined
}

/** 微博网页永久链接：`https://weibo.com/<uid>/<mblogid>`。 */
function buildSourceUrl(user: TweetUser, mblogId: string): string | undefined {
  if (!user.id || !mblogId)
    return undefined
  return `https://weibo.com/${user.id}/${mblogId}`
}

/**
 * 将原始微博数据归一化为标准化 ITweet 对象。
 *
 * 纯函数，不依赖类实例。
 */
export function normalizeTweet(raw: RawTweet): ITweet {
  const rawRecord = raw as unknown as UnknownRecord

  const visibleType = Number(raw.visible?.type ?? 0)
  const user = normalizeUser(raw.user)

  const retweeted = rawRecord.retweeted_status
  const retweetedStatus = retweeted ? normalizeTweet(retweeted as unknown as RawTweet) : undefined

  return {
    id: String(raw.idstr || raw.id),
    mblogId: raw.mblogid,
    createdAt: raw.created_at,
    text: raw.text_raw || '',
    textHtml: raw.text || '',
    regionName: raw.region_name || undefined,
    source: String(raw.source || ''),
    user,
    stats: {
      likes: Number(raw.attitudes_count ?? 0),
      comments: Number(raw.comments_count ?? 0),
      reposts: Number(raw.reposts_count ?? 0),
    },
    visible: isTweetVisible(visibleType) ? visibleType : TweetVisible.PUBLIC,
    media: extractMedia(raw, rawRecord),
    pageInfo: extractPageInfo(rawRecord),
    geo: extractGeo(raw),
    retweetedStatus,
    repostChain: extractRepostChain(rawRecord),
    topics: extractTopics(rawRecord),
    linkCards: extractLinkCards(rawRecord),
    readCount: getNumber(rawRecord.reads_count),
    editCount: getNumber(rawRecord.edit_count),
    title: extractTitle(rawRecord),
    permanentVideoUrl: extractPermanentVideoUrl(rawRecord),
    isOriginal: retweetedStatus === undefined,
    sourceUrl: buildSourceUrl(user, raw.mblogid),
    atUsers: extractAtUsers(rawRecord),
    playCount: extractPlayCount(rawRecord),
    isTop: extractIsTop(rawRecord),
    audio: extractAudio(rawRecord),
  }
}

/**
 * 把「id 形态」（string / number）的 raw 字段归一化为非空字符串 id。
 *
 * 上游同一 id 会以 `rootidstr`（string）与 `rootid`（number）双份下发；`0` / `''` / 缺失
 * 一律视为「未下发」（`rootid: 0` 是「没有根评论」的哨兵值，不是有效 id）。
 */
function toIdString(value: unknown): string | undefined {
  if (typeof value === 'string')
    return value.length > 0 ? value : undefined
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0)
    return String(value)
  return undefined
}

/** 解析「非负整数」型 raw 字段（`floor_number` / `total_number`）；非法值视为未下发。 */
function parseNonNegativeInt(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isInteger(value) && value >= 0 ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
  }
  return undefined
}

/** 取内嵌 `status` 的 `mblogid`（被评论微博的字母 id）；缺失 / 非字符串时返回 undefined。 */
function getParentMblogId(rawRecord: UnknownRecord): string | undefined {
  const status = rawRecord.status
  if (!isRecord(status))
    return undefined
  const mblogid = status.mblogid
  return typeof mblogid === 'string' && mblogid.length > 0 ? mblogid : undefined
}

/** 评论配图的尺寸优先级：原图优先，`thumbnail` 兜底。 */
const COMMENT_PIC_SIZE_KEYS = ['largest', 'original', 'woriginal', 'mw2000', 'large', 'bmiddle', 'thumbnail'] as const

/**
 * 图片评论配图：上游把图片放在 `url_struct[].pic_infos` 的「查看图片」卡片里。
 *
 * 多图评论可能下发多个 `url_struct` 项并重复同一 `pic_infos`，按 `pic_id` 去重；
 * 无图片卡片时返回 undefined（调用方据此省略 optional 字段）。
 */
function extractCommentPics(record: UnknownRecord): TweetCommentPic[] | undefined {
  const urlStruct = record.url_struct
  if (!Array.isArray(urlStruct))
    return undefined

  const pics = new Map<string, TweetCommentPic>()
  for (const item of urlStruct) {
    if (!isRecord(item) || !isRecord(item.pic_infos))
      continue

    for (const [fallbackId, rawInfo] of Object.entries(item.pic_infos)) {
      if (!isRecord(rawInfo))
        continue

      let best: UnknownRecord | undefined
      for (const key of COMMENT_PIC_SIZE_KEYS) {
        const candidate = rawInfo[key]
        if (isRecord(candidate) && typeof candidate.url === 'string' && candidate.url.length > 0) {
          best = candidate
          break
        }
      }
      if (!best)
        continue

      const id = getString(rawInfo.pic_id) ?? fallbackId
      if (!id || pics.has(id))
        continue

      pics.set(id, {
        id,
        imageUrl: best.url as string,
        width: getNumber(best.width) ?? 0,
        height: getNumber(best.height) ?? 0,
      })
    }
  }

  return pics.size > 0 ? [...pics.values()] : undefined
}

/**
 * 评论归一化递归核（纯函数）。
 *
 * `includeReplies` 区分「楼中楼列表」`comments` 是否展开：
 * - 顶层评论（`normalizeComment`）展开；
 * - `reply_comment`（被回复评论）不展开——`reply_comment` 与 `comments` 是两个不同字段，
 *   被回复评论里若残留 `comments` 不应被误读成「谁回复了它」。
 */
function normalizeCommentNode(raw: unknown, includeReplies: boolean): ITweetComment {
  const record = isRecord(raw) ? raw : {}

  const comment: ITweetComment = {
    id: String(record.idstr || record.id || ''),
    createdAt: String(record.created_at || ''),
    text: String(record.text_raw ?? record.text ?? ''),
    textHtml: String(record.text ?? record.text_raw ?? ''),
    source: String(record.source || ''),
    likes: getNumber(record.like_counts ?? record.like_count) ?? 0,
    user: normalizeUser(record.user),
  }

  const pics = extractCommentPics(record)
  if (pics)
    comment.pics = pics

  const rootId = toIdString(record.rootidstr) ?? toIdString(record.rootid)
  if (rootId !== undefined)
    comment.rootId = rootId

  const floorNumber = parseNonNegativeInt(record.floor_number)
  if (floorNumber !== undefined)
    comment.floorNumber = floorNumber

  // 只有 raw 真的带 `total_number` 时才填（myCmt 的评论项通常没有该字段）
  const totalReplies = parseNonNegativeInt(record.total_number)
  if (totalReplies !== undefined)
    comment.totalReplies = totalReplies

  if (typeof record.liked === 'boolean')
    comment.liked = record.liked

  const parentMblogId = getParentMblogId(record)
  if (parentMblogId !== undefined)
    comment.parentMblogId = parentMblogId

  const replyToRaw = record.reply_comment
  if (isRecord(replyToRaw))
    comment.replyTo = normalizeCommentNode(replyToRaw, false)

  if (includeReplies && Array.isArray(record.comments)) {
    const replies = record.comments.map((reply: unknown) => normalizeCommentNode(reply, true))
    if (replies.length > 0)
      comment.replies = replies
  }

  return comment
}

/**
 * 将 `buildComments` / `myCmt` 的原始评论归一化为 `ITweetComment`（P1-6 / D2）。
 *
 * - `replies` 取上游 `comments` 数组并递归归一化（普通时间线归一化不会调用本函数）；
 * - D2 追加：`rootId`（`rootidstr`/`rootid`）、`replyTo`（`reply_comment`，递归）、
 *   `floorNumber`（`floor_number`）、`totalReplies`（`total_number`，缺省即省略）、
 *   `liked`（`liked`，缺省即省略）、`parentMblogId`（内嵌 `status.mblogid`）。
 * - 图片评论：`pics` 取 `url_struct[].pic_infos`（最大尺寸 URL），按 `pic_id` 去重。
 * - `status` / `reply_comment` 缺失时不抛错，只是对应 optional 字段不出现。
 *
 * 保持向后兼容：`id` / `createdAt` / `text` / `textHtml` / `source` / `likes` / `user` 语义不变。
 */
export function normalizeComment(raw: unknown): ITweetComment {
  return normalizeCommentNode(raw, true)
}

/**
 * 归一化点赞者（`/api/attitudes/show` 的 `data.data[]`）：简版用户 + 点赞时间/来源。
 *
 * 纯函数；缺失用户字段时按 `normalizeUser` 的默认值处理（空串 / false）。
 */
export function normalizeLiker(raw: unknown): TweetLiker {
  const record = isRecord(raw) ? raw : {}
  const liker: TweetLiker = { ...normalizeUser(record.user) }
  if (typeof record.created_at === 'string' && record.created_at.length > 0)
    liker.likedAt = record.created_at
  if (typeof record.source === 'string' && record.source.length > 0)
    liker.source = record.source
  return liker
}

export class Tweet implements ITweet {
  public createdAt!: string
  public id!: string
  public mblogId!: string
  public media!: TweetMedia[]
  public source!: string
  public stats!: { likes: number, comments: number, reposts: number }
  public text!: string
  public textHtml!: string
  public user!: TweetUser
  public visible!: TweetVisible
  public regionName?: string
  public pageInfo?: TweetPageCard
  public retweetedStatus?: ITweet
  public geo?: TweetGeo
  public comments?: ITweetComment[]

  constructor(raw: RawTweet) {
    Object.assign(this, normalizeTweet(raw))
  }
}
