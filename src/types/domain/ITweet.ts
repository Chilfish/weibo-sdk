import type { VerificationType } from './IUser'

/**
 * ITweet 存档契约版本（K1 / P0-1，2026-09-04 冻结 v1）。
 *
 * `ITweet` 是下游（Weibo-archiver web-v3 / monkey / CLI）的 UI 展示与磁盘存档终局契约
 * （ADR-007/008）。版本规则（与包版本解耦，见 docs/engineering/contract-itweet-v1.md）：
 * - **v1 内**：字段只增不改——仅允许新增 optional 字段（读取方忽略未知键，非破坏）；
 * - **v2**：rename / remove / 类型或语义变更必须升契约版本，随包 major 发布，并提供迁移函数。
 */
export const TWEET_CONTRACT_VERSION = 1 as const

export type TweetContractVersion = typeof TWEET_CONTRACT_VERSION

export interface ITweet {
  id: string
  /** 字母形式的 id (如 QqsYymYOS) */
  mblogId: string
  createdAt: string
  text: string
  textHtml: string
  regionName?: string
  source: string

  // 用户信息
  user: TweetUser

  // 计数统计
  stats: {
    likes: number
    comments: number
    reposts: number
  }

  visible: TweetVisible

  // 转发内容
  retweetedStatus?: ITweet

  // 网页卡片或视频卡片
  pageInfo?: TweetPageCard

  // 媒体内容
  media: TweetMedia[]

  geo?: TweetGeo
}

/**
 * 用户信息简版
 */
export interface TweetUser {
  id: string
  name: string
  avatar: string
  verified: boolean
  verifiedType: VerificationType
}

/**
 * 隐私可见性
 */
export enum TweetVisible {
  /** 公开可见 */
  PUBLIC = 0,
  /** 仅自己可见 */
  PRIVATE = 1,
  /** 仅互关好友可见 */
  FRIENDS = 2,
  /** 仅粉丝可见 */
  FOLLOWERS = 3,
  /** 仅群组可见 */
  GROUP = 4,
}

export enum MediaType {
  PIC = 'pic',
  VIDEO = 'video',
  LIVEPHOTO = 'livephoto',
  GIF = 'gif',
  UNKNOWN = 'unknown',
}

/**
 * 标准化媒体资源 (图片、视频、LivePhoto、GIF)
 *
 * 【契约（P0-2 裁定，2026-09-04）】`imageUrl` / `videoUrl` 是上游**临时签名 URL**：
 * 有效期 = 请求时间 + 1 小时、一次性（再次下发新 URL 后旧链接作废），**不是长期存档资产**。
 * SDK 不下载媒体；持久化由存档消费方（archiver）在归档时及时完成，
 * 过期后可经 SDK 重新拉取单条微博获取新 URL。详见 contract-itweet-v1.md。
 */
export interface TweetMedia {
  id: string
  type: MediaType
  // 上传后是找不到原图的，largest 是最大尺寸。4k大小被裁成2k
  // 视频封面从 big_pic_info 找
  imageUrl: string

  videoUrl?: string // mp4 或 mov 地址
  duration?: number // 视频时长（秒）

  width: number
  height: number
}

/**
 * 页面卡片 (如链接预览、视频封面)
 */
export interface TweetPageCard {
  pageId: string
  pageTitle: string
  pageUrl: string
  pagePic: string // 封面图
  type: number
  objectType: string
}

/**
 * 发微博选的定位
 */
export interface TweetGeo {
  /** 纬度 */
  latitude: number
  /** 经度 */
  longitude: number
  /** 地址名称 */
  address: string
  // 分选模糊坐标点和选定定位列表
  // 但总能从 tag_struct.find(tag => tag.otype === "place").tag_name 找到定位名称
}
