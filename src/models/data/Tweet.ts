import type { ITweet, TweetGeo, TweetMedia, TweetPageCard, TweetUser } from '~/types/domain/ITweet'
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
    user: {
      id: String(raw.user?.idstr || raw.user?.id || ''),
      name: raw.user?.screen_name || '',
      avatar: raw.user?.avatar_hd || raw.user?.avatar_large || raw.user?.profile_image_url || '',
      verified: !!raw.user?.verified,
      verifiedType: (raw.user?.verified_type ?? 0) as unknown as VerificationType,
    },
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

  constructor(raw: RawTweet) {
    Object.assign(this, normalizeTweet(raw))
  }
}
