import type { VerificationType } from './IUser'

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
 */
export interface TweetMedia {
  id: string
  type: MediaType
  // 上传后是找不到原图的，largest 是最大尺寸。4k大小被裁成2k
  // 视频封面从 big_pic_info 找
  imageUrl: string

  // 视频、实况照片都带了过期时间和签名参数，一次性有效，再次下发新url后，旧的就作废了
  // 有效期为请求时间+1小时
  // 所以感觉没法做成在线的，只能及时就地下载
  // 要么就在查看时在服务端去请求拿新的链接
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
