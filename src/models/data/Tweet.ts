import type { ITweet, TweetGeo, TweetMedia, TweetPageCard, TweetUser } from '~/types/domain/ITweet'
import type { VerificationType } from '~/types/domain/IUser'
import type { MyMBLog } from '~/types/raw/tweet/mymblog'
import { MediaType, TweetVisible } from '~/types/domain/ITweet'

export type RawTweet = MyMBLog | NonNullable<MyMBLog['retweeted_status']>
type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object'
}

function getNumber(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : undefined
}

export class Tweet implements ITweet {
  public createdAt: string
  public id: string
  public mblogId: string
  public media: TweetMedia[]
  public source: string
  public stats: { likes: number, comments: number, reposts: number }
  public text: string
  public textHtml: string
  public user: TweetUser
  public visible: TweetVisible
  public regionName?: string
  public pageInfo?: TweetPageCard
  public retweetedStatus?: ITweet
  public geo?: TweetGeo

  constructor(raw: RawTweet) {
    const rawRecord = raw as unknown as UnknownRecord

    this.id = String(raw.idstr || raw.id)
    this.mblogId = raw.mblogid
    this.createdAt = raw.created_at

    this.text = raw.text_raw || ''
    this.textHtml = raw.text || ''
    this.regionName = raw.region_name || undefined

    this.source = String(raw.source || '')

    this.user = {
      id: String(raw.user.idstr || raw.user.id),
      name: raw.user.screen_name || '',
      avatar: raw.user.avatar_hd || raw.user.avatar_large || raw.user.profile_image_url || '',
      verified: !!raw.user.verified,
      verifiedType: (raw.user.verified_type ?? 0) as unknown as VerificationType,
    }

    this.stats = {
      likes: Number(raw.attitudes_count ?? 0),
      comments: Number(raw.comments_count ?? 0),
      reposts: Number(raw.reposts_count ?? 0),
    }

    const visibleType = Number(raw.visible?.type ?? 0)
    this.visible = (Object.values(TweetVisible).includes(visibleType as any)
      ? visibleType
      : TweetVisible.PUBLIC) as TweetVisible

    this.media = this.extractMedia(raw, rawRecord)
    this.pageInfo = this.extractPageInfo(rawRecord)
    this.geo = this.extractGeo(raw)

    const retweeted = rawRecord.retweeted_status
    this.retweetedStatus = retweeted ? new Tweet(retweeted as unknown as RawTweet) : undefined
  }

  private extractPageInfo(rawRecord: UnknownRecord): TweetPageCard | undefined {
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

  private extractGeo(raw: RawTweet): TweetGeo | undefined {
    const coords = this.getCoordinates(raw)
    if (!coords)
      return undefined

    const [longitude, latitude] = coords
    const address = this.getGeoAddress(raw) || ''

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
      return undefined

    return {
      latitude,
      longitude,
      address,
    }
  }

  private getGeoAddress(raw: RawTweet): string | undefined {
    const tags = (raw as MyMBLog).tag_struct
    if (!Array.isArray(tags))
      return undefined

    const place = tags.find((t) => {
      if (!isRecord(t))
        return false
      return t.otype === 'place'
    })
    const name = isRecord(place) ? place.tag_name : undefined
    return typeof name === 'string' ? name : undefined
  }

  private getCoordinates(raw: RawTweet): [number, number] | undefined {
    const geo = (raw as MyMBLog).geo
    if (!isRecord(geo))
      return undefined

    const coordinates = geo.coordinates
    if (!Array.isArray(coordinates) || coordinates.length < 2)
      return undefined

    const lon = getNumber(coordinates[0])
    const lat = getNumber(coordinates[1])
    if (lon === undefined || lat === undefined)
      return undefined
    return [lon, lat]
  }

  private extractMedia(raw: RawTweet, rawRecord: UnknownRecord): TweetMedia[] {
    const fromMix = this.extractMediaFromMixMediaInfo(rawRecord)
    if (fromMix.length > 0)
      return fromMix

    return this.extractMediaFromPicInfos(raw)
  }

  private extractMediaFromMixMediaInfo(rawRecord: UnknownRecord): TweetMedia[] {
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

  private extractMediaFromPicInfos(raw: RawTweet): TweetMedia[] {
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

      const isGif = info.type === 'gif'
      const hasVideo = typeof info.video === 'string' && info.video.length > 0

      out.push({
        id: typeof info.pic_id === 'string' ? info.pic_id : String(picId),
        type: hasVideo ? MediaType.LIVEPHOTO : isGif ? MediaType.GIF : MediaType.PIC,
        imageUrl: url,
        videoUrl: hasVideo ? info.video : undefined,
        width: getNumber(best?.width) ?? 0,
        height: getNumber(best?.height) ?? 0,
      })
    }

    return out
  }
}
