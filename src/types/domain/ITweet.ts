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

/**
 * `TWEET_CONTRACT_VERSION` 的字面量类型（当前仅 `1`）。
 */
export type TweetContractVersion = typeof TWEET_CONTRACT_VERSION

/**
 * 归一化微博（下游 UI 展示与磁盘存档的终局契约，见 {@link TWEET_CONTRACT_VERSION}）。
 *
 * 由 `new Tweet(raw)` 归一化而来：上游 raw 字段不直接暴露，缺失值有明确默认；
 * v1 内只允许新增 optional 字段，读取方需忽略未知键。
 */
export interface ITweet {
  /** 数字串微博 id（`idstr`） */
  id: string
  /** 字母形式的 id (如 QqsYymYOS) */
  mblogId: string
  /** 发布时间（上游 `created_at` 原样字符串，含时区） */
  createdAt: string
  /** 纯文本正文（长文按上游返回值截断，完整正文需 `enrich({ includeLongText: true })`） */
  text: string
  /** HTML 片段正文（用于富文本渲染；只读展示，勿直接 innerHTML 未净化内容） */
  textHtml: string
  /** 发布地（地区名，如「北京」；未提供时缺省） */
  regionName?: string
  /** 来源（如「微博网页版」） */
  source: string

  // 用户信息
  /** 作者信息（简版，不含完整 `IUser` 字段） */
  user: TweetUser

  // 计数统计
  /** 互动计数快照（随抓取时间变化，不代表实时值） */
  stats: {
    /** 点赞数 */
    likes: number
    /** 评论数 */
    comments: number
    /** 转发数 */
    reposts: number
  }

  /** 可见范围（对应上游 `visible.type`） */
  visible: TweetVisible

  // 转发内容
  /** 被转发的原微博（同构递归；非转发微博缺省） */
  retweetedStatus?: ITweet

  // 网页卡片或视频卡片
  /** 网页卡片 / 视频卡片信息（链接预览等；无卡片时缺省） */
  pageInfo?: TweetPageCard

  // 媒体内容
  /** 媒体列表（图片/视频/LivePhoto/GIF；无媒体时为空数组） */
  media: TweetMedia[]

  /** 定位信息（发布时选点；未选点缺省） */
  geo?: TweetGeo

  /**
   * 评论（P1-6，可选）。
   *
   * 普通 `normalizeTweet` 不填充；仅归档流 `includeComments: true` 时由 SDK 拉取并挂载。
   * v1 新增 optional 字段，老读取方忽略即可。
   */
  comments?: ITweetComment[]
}

/**
 * 评论（P1-6）。`replies` 为楼中楼，递归同构；缺省表示没有回复。
 */
export interface ITweetComment {
  /** 评论 id（`idstr` 或 `id` 的字符串形式） */
  id: string
  /** 评论时间（上游 `created_at` 原样字符串） */
  createdAt: string
  /** 纯文本内容 */
  text: string
  /** HTML 片段内容（可能含表情 `img`，展示前需净化） */
  textHtml: string
  /** 来源（如「微博网页版」） */
  source: string
  /** 点赞数 */
  likes: number
  /** 评论作者（简版用户信息） */
  user: TweetUser
  /** 楼中楼回复（递归同构；无回复时缺省） */
  replies?: ITweetComment[]
}

/**
 * 用户信息简版
 */
export interface TweetUser {
  /** 数字串用户 id（`idstr`） */
  id: string
  /** 昵称 */
  name: string
  /** 头像 URL */
  avatar: string
  /** 是否已认证 */
  verified: boolean
  /** 认证类型（对应上游 `verified_type`，未认证为 -1） */
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

/**
 * 媒体类型（对应上游 `mix_media_info` / 图片 `type` 的归一化结果）。
 */
export enum MediaType {
  /** 静态图片 */
  PIC = 'pic',
  /** 视频 */
  VIDEO = 'video',
  /** 实况照片 */
  LIVEPHOTO = 'livephoto',
  /** 动图 */
  GIF = 'gif',
  /** 无法识别的类型（保留条目，避免丢数据） */
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
  /** 媒体 id（上游 `pid` / 视频 id） */
  id: string
  /** 媒体类型 */
  type: MediaType
  // 上传后是找不到原图的，largest 是最大尺寸。4k大小被裁成2k
  // 视频封面从 big_pic_info 找
  /** 图片地址或视频封面地址（临时 URL，见接口注释；可能为空串） */
  imageUrl: string

  /** 视频地址（mp4 或 mov；非视频缺省） */
  videoUrl?: string
  /** 视频时长（秒；非视频缺省） */
  duration?: number

  /** 原始宽度（像素） */
  width: number
  /** 原始高度（像素） */
  height: number
}

/**
 * 页面卡片 (如链接预览、视频封面)
 */
export interface TweetPageCard {
  /** 卡片 id（上游 `page_id`） */
  pageId: string
  /** 卡片标题 */
  pageTitle: string
  /** 卡片跳转链接 */
  pageUrl: string
  /** 封面图 */
  pagePic: string
  /** 卡片类型码（上游 `type`） */
  type: number
  /** 卡片对象类型（上游 `object_type`） */
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
