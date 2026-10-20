import type { IUserMediaAsset } from '~/types/domain/IUserMediaAsset'
import { MediaType } from '~/types/domain/ITweet'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 取第一个非空字符串（`number` 会被转成字符串），用于 fallback 链。 */
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0)
      return value
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value)
  }
  return undefined
}

/** 取有限数字（接受数字字符串）；非法值返回 undefined。 */
function toNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 上游 `type` → `MediaType`；未知值保留为 `UNKNOWN`，避免丢条目。 */
function mapMediaType(type: string | undefined): MediaType {
  switch (type) {
    case 'pic':
      return MediaType.PIC
    case 'gif':
      return MediaType.GIF
    case 'livephoto':
      return MediaType.LIVEPHOTO
    case 'video':
      return MediaType.VIDEO
    default:
      return MediaType.UNKNOWN
  }
}

/**
 * 图片墙的图片地址构造规则：`https://wx3.sinaimg.cn/large/<pid>.<ext>`。
 *
 * 真实样本（`image_wall_p1.json`）只给 `pid`，页面用该拼接规则展示；
 * GIF 用 `.gif`，其余（pic / livephoto 的静态帧）用 `.jpg`。
 */
function buildImageUrl(pid: string, type: string | undefined): string {
  if (!pid)
    return ''
  const ext = type === 'gif' ? 'gif' : 'jpg'
  return `https://wx3.sinaimg.cn/large/${pid}.${ext}`
}

/**
 * 归一化图片墙条目（`GET /ajax/profile/getImageWall` 的 `data.list[]`）。
 *
 * 纯函数；`pid` 缺失时仍产出条目（`id` / `url` 为空串），由调用方决定是否过滤。
 */
export function normalizeImageWallItem(raw: unknown): IUserMediaAsset {
  const record = isRecord(raw) ? raw : {}
  const pid = firstString(record.pid) ?? ''
  const rawType = firstString(record.type)
  const type = mapMediaType(rawType)
  const imageUrl = buildImageUrl(pid, rawType)
  const videoUrl = firstString(record.video)

  const year = firstString(record.timeline_year)
  const month = firstString(record.timeline_month)
  const createdAt = year && month ? `${year}-${month.padStart(2, '0')}` : undefined

  const asset: IUserMediaAsset = {
    id: pid,
    type,
    // 图片墙里若出现 video 类型，主资源用视频直链、封面用 pid 构造的静态图
    url: type === MediaType.VIDEO && videoUrl ? videoUrl : imageUrl,
  }

  const sourceTweetId = firstString(record.mid)
  if (sourceTweetId !== undefined)
    asset.sourceTweetId = sourceTweetId
  if (imageUrl.length > 0)
    asset.coverUrl = imageUrl
  if (videoUrl !== undefined)
    asset.videoUrl = videoUrl
  if (createdAt !== undefined)
    asset.createdAt = createdAt
  const objectId = firstString(record.object_id)
  if (objectId !== undefined)
    asset.objectId = objectId

  return asset
}

/**
 * 从视频瀑布的微博条目（`GET /ajax/profile/getWaterFallContent` 的 `data.list[]`）
 * 提取视频资产。
 *
 * 上游视频信息在 `page_info.media_info`：直链优先 `mp4_hd_url` → `stream_url_hd` →
 * `stream_url` → `mp4_sd_url`；封面优先 `page_pic` → `big_pic_info.pic_big.url`。
 * 非视频条目返回 `undefined`。
 */
export function normalizeWaterfallVideo(raw: unknown): IUserMediaAsset | undefined {
  const record = isRecord(raw) ? raw : {}
  const page = isRecord(record.page_info) ? record.page_info : undefined
  const media = page && isRecord(page.media_info) ? page.media_info : undefined
  if (!page || !media)
    return undefined

  const mediaType = firstString(media.media_type, page.object_type)
  if (mediaType !== 'video')
    return undefined

  const bigPic = isRecord(media.big_pic_info) && isRecord(media.big_pic_info.pic_big)
    ? media.big_pic_info.pic_big
    : undefined
  const videoUrl = firstString(media.mp4_hd_url, media.stream_url_hd, media.stream_url, media.mp4_sd_url)
  const coverUrl = firstString(page.page_pic, bigPic?.url)
  // 一条微博对应一个视频；优先用 mblogid 作为资产 id（脱敏后 media_id/page_id 会退化为占位符）
  const id = firstString(record.mblogid, record.idstr, media.media_id, page.page_id, page.object_id, record.id)
  if (id === undefined)
    return undefined

  const asset: IUserMediaAsset = {
    id,
    type: MediaType.VIDEO,
    url: videoUrl ?? coverUrl ?? '',
  }

  if (coverUrl !== undefined)
    asset.coverUrl = coverUrl
  if (videoUrl !== undefined)
    asset.videoUrl = videoUrl
  const duration = toNumber(media.duration)
  if (duration !== undefined)
    asset.duration = duration
  const width = toNumber(bigPic?.width)
  if (width !== undefined)
    asset.width = width
  const height = toNumber(bigPic?.height)
  if (height !== undefined)
    asset.height = height

  const createdAt = firstString(record.created_at)
  if (createdAt !== undefined)
    asset.createdAt = createdAt
  const sourceTweetId = firstString(record.idstr, record.id)
  if (sourceTweetId !== undefined)
    asset.sourceTweetId = sourceTweetId
  const sourceMblogId = firstString(record.mblogid)
  if (sourceMblogId !== undefined)
    asset.sourceMblogId = sourceMblogId
  const permanentPageUrl = firstString(media.h5_url)
  if (permanentPageUrl !== undefined)
    asset.permanentPageUrl = permanentPageUrl

  return asset
}
