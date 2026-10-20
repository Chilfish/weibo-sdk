import type { ITweet, ITweetComment, TweetGeo, TweetMedia, TweetPageCard, TweetUser } from '~/types/domain/ITweet'
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

function getNumber(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : undefined
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

  return {
    pageId: String(page.page_id ?? ''),
    pageTitle: String(page.page_title ?? ''),
    pageUrl: String(page.page_url ?? ''),
    pagePic: String(page.page_pic ?? ''),
    type: getNumber(page.type) ?? 0,
    objectType: String(page.object_type ?? ''),
  }
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

    const best = isRecord(info.largest) ? info.largest
      : isRecord(info.original) ? info.original
        : isRecord(info.mw2000) ? info.mw2000
          : isRecord(info.large) ? info.large
            : isRecord(info.bmiddle) ? info.bmiddle
              : isRecord(info.thumbnail) ? info.thumbnail
                : undefined
    const url = best && typeof best.url === 'string' ? best.url : undefined
    if (!url)
      continue

    const type = typeof info.type === 'string' ? info.type : undefined
    const videoUrl = typeof info.video === 'string' && info.video.length > 0 ? info.video : undefined
    const isGif = type === 'gif'

    out.push({
      id: typeof info.pic_id === 'string' ? info.pic_id : String(picId),
      type: videoUrl ? MediaType.LIVEPHOTO : isGif ? MediaType.GIF : MediaType.PIC,
      imageUrl: url,
      videoUrl,
      width: getNumber(best?.width) ?? 0,
      height: getNumber(best?.height) ?? 0,
    })
  }

  return out
}

function extractMedia(raw: RawTweet, rawRecord: UnknownRecord): TweetMedia[] {
  const fromMix = extractMediaFromMixMediaInfo(rawRecord)
  if (fromMix.length > 0)
    return fromMix

  return extractMediaFromPicInfos(raw)
}

/**
 * 将原始微博数据归一化为标准化 ITweet 对象。
 *
 * 纯函数，不依赖类实例。
 */
export function normalizeTweet(raw: RawTweet): ITweet {
  const rawRecord = raw as unknown as UnknownRecord

  const visibleType = Number(raw.visible?.type ?? 0)

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
    user: normalizeUser(raw.user),
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
 * - `status` / `reply_comment` 缺失时不抛错，只是对应 optional 字段不出现。
 *
 * 保持向后兼容：`id` / `createdAt` / `text` / `textHtml` / `source` / `likes` / `user` 语义不变。
 */
export function normalizeComment(raw: unknown): ITweetComment {
  return normalizeCommentNode(raw, true)
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
