/**
 * Agent 视角的单条微博上下文（`weibo.tweet-context/v1`）。
 *
 * 与 `ITweet` 的关系：
 * - `ITweet` 是存档终局契约（v1 冻结，只增不改），忠实保留微博记录；
 * - `ITweetContext` 是**确定性投影**，回答「AI 理解这条微博需要哪些上下文」：
 *   谁说的、什么时候、作者本人说了什么、配了什么、和谁有关、别人怎么反应、哪些是未知。
 *
 * 该结构不调用任何 LLM，也不做总结；OCR / 视觉描述 / 视频转写由调用方回填到
 * `TweetContextMedia` 的可选槽位。
 */
export const TWEET_CONTEXT_SCHEMA = 'weibo.tweet-context/v1' as const

/** `ITweetContext.post.kind`：原创或转发。 */
export type TweetContextKind = 'original' | 'repost'

/** 可见性（与 `TweetVisible` 对齐，未知值归为 `unknown`）。 */
export type TweetContextVisibility
  = | 'public'
    | 'private'
    | 'friends'
    | 'followers'
    | 'group'
    | 'unknown'

/** 作者信息（在 `TweetUser` 基础上补充理解所需的身份上下文）。 */
export interface TweetContextAuthor {
  /** 数字串 uid */
  id: string
  /** 昵称 */
  name: string
  /** 主页地址 */
  url?: string
  /** 是否认证 */
  verified: boolean
  /** 认证类型（上游 `verified_type`） */
  verifiedType: number
  /** 认证说明（上游 `verified_reason`） */
  verifiedReason?: string
  /** 个人简介 */
  description?: string
  /** 粉丝数 */
  followers?: number
  /** 当前登录用户是否关注了 TA（仅 Cookie 模式且上游下发时存在） */
  following?: boolean
  /** TA 是否关注了当前登录用户（仅 Cookie 模式且上游下发时存在） */
  followedBy?: boolean
}

/** 互动计数快照（随抓取时间变化，不代表实时值）。 */
export interface TweetContextStats {
  likes: number
  comments: number
  reposts: number
  reads?: number
}

/** 影响理解、但不属于正文的原始标记。 */
export interface TweetContextFlags {
  /** 广告（上游 `isAd`） */
  isAd?: boolean
  /** 付费内容（上游 `is_paid`） */
  isPaid?: boolean
  /** 上游标记长文但未补拉全文（正文字段可能被截断） */
  textTruncated?: boolean
  /** 编辑次数 > 0（上游 `edit_count`） */
  edited?: boolean
  /** 置顶（上游 `isTop`） */
  pinned?: boolean
  /** 内容分级 / 内容警告（上游 `content_auth`，语义待确认，原样保留） */
  contentAuth?: number
}

/** 媒体归属：当前微博自己的，还是转发的原微博的。 */
export type TweetContextMediaRelation = 'self' | 'quoted'

/** 媒体下载结果（与 `MediaDownloadItem` 对齐，只保留 Agent 需要的字段）。 */
export interface TweetContextMediaDownload {
  /** 本地绝对路径 */
  path: string
  /** 下载状态 */
  status: 'downloaded' | 'skipped' | 'planned' | 'failed'
  /** 文件字节数（`downloaded` / `skipped` 时可用） */
  bytes?: number
  /** MIME 类型（上游未下发时缺省） */
  contentType?: string
}

/**
 * 单条媒体上下文。
 *
 * `url` 与 `ITweet.media` 一样是**临时签名 URL**（约 1 小时有效），
 * 因此同时提供 `temporary: true` 与可选的 `download.path`：
 * Agent 需要读取画面时，优先使用本地路径；只有 URL 时必须立即下载。
 */
export interface TweetContextMedia {
  /** 1-based 顺序，与原微博媒体顺序一致 */
  index: number
  /** 媒体 id（上游 `pid` / 视频 id） */
  mediaId: string
  /** 归属：`self` = 当前微博，`quoted` = 转发的原微博 */
  owner: { mblogId: string, relation: TweetContextMediaRelation }
  /** 媒体类型 */
  type: 'pic' | 'gif' | 'livephoto' | 'video' | 'unknown'
  /** 主资源 URL（视频为视频直链，其余为图片地址）；临时签名 URL */
  url: string
  /** 视频 / 动态媒体封面 */
  coverUrl?: string
  /** 像素宽度 */
  width: number
  /** 像素高度 */
  height: number
  /** 宽高比（保留两位小数；未知时为 0） */
  aspectRatio: number
  /** 视频 / 音频时长（秒） */
  duration?: number
  /** 明确标记 URL 会过期，提示调用方及时下载 */
  temporary: true
  /** 确定性提示（长图、图集、正文指代图片、需要转写等） */
  hints: string[]
  /** 下载结果（调用方或 CLI `--download-media` 回填） */
  download?: TweetContextMediaDownload
  /** 可选：画面描述（调用方注入；SDK 不生成） */
  description?: string
  /** 可选：图片 OCR 文本（调用方注入） */
  ocrText?: string
  /** 可选：视频 / 音频转写（调用方注入） */
  transcript?: string
}

/** 正文内的链接（来自 `linkCards`；`title` 可能为空串）。 */
export interface TweetContextLink {
  title: string
  url: string
}

/** 转发链的一层。`index = 0` 是当前作者，`> 0` 是由近到远的转发者。 */
export interface TweetContextRepostEntry {
  index: number
  /** 该层作者昵称（无法解析时缺省） */
  author?: string
  /** 该层正文（已清理零宽字符与图片短链） */
  text: string
  /** 固定为 `commentary`：每一层都是转发者的话，不是原微博正文 */
  role: 'commentary'
}

/** 抽样评论（按热度或时间排序，不代表全部评论）。 */
export interface TweetContextComment {
  author: string
  /** 评论者 uid（上游下发时） */
  userId?: string
  text: string
  likes: number
  /** 楼中楼回复数（上游下发时） */
  replies?: number
  /** 是否为当前微博作者本人的评论（调用方 / Service 可回填） */
  isAuthor?: boolean
}

/** `post` 字段集合。 */
export interface TweetContextPost {
  kind: TweetContextKind
  id: string
  mblogId: string
  /** 微博网页永久链接 */
  url?: string
  author: TweetContextAuthor
  /** UTC ISO 时间 */
  publishedAt: string
  /** 带原始时区偏移的本地时间（如 `2026-10-20T15:40:07+08:00`） */
  publishedAtLocal?: string
  source: string
  /** 发布地（已去掉「发布于」前缀） */
  location?: string
  visibility: TweetContextVisibility
  /** 当前作者本人的正文（转发时只取第 0 层，不包含 `//@` 链） */
  text: string
  topics: string[]
  /** 当前作者正文中 @ 的用户名（不含转发链作者） */
  mentions: string[]
  links: TweetContextLink[]
  stats: TweetContextStats
  flags: TweetContextFlags
}

/** 抓取来源与时效信息。 */
export interface TweetContextProvenance {
  /** 抓取时间（UTC ISO） */
  fetchedAt: string
  /** 数据来源说明（如 `sdk.tweets.context`） */
  via: string
  /** 本次抽样了多少条评论 */
  commentsSampled?: number
  /** 是否补拉了长微博全文 */
  longTextFetched?: boolean
  /** 本次使用的鉴权模式 */
  authMode?: 'cookie' | 'guest'
}

/**
 * Agent 视角的微博上下文。
 *
 * 约定：
 * - `post.text` 永远是**当前作者本人**的发言；
 * - `quoted` 是转发的原微博（默认只展开一层）；
 * - `media[]` 只包含当前微博自己的媒体，原微博媒体在 `quoted.media[]`；
 * - 任何无法确定的信息必须出现在 `unknowns` / `hints`，不能伪造默认值。
 */
export interface ITweetContext {
  schema: typeof TWEET_CONTEXT_SCHEMA
  post: TweetContextPost
  media: TweetContextMedia[]
  /** 转发的原微博（递归；达到展开深度时缺省） */
  quoted?: ITweetContext
  /** 转发链（仅当上游 `text` 拍平了 `//@` 或多层转发时存在） */
  repostChain?: TweetContextRepostEntry[]
  /** 抽样评论 */
  discussion?: TweetContextComment[]
  provenance: TweetContextProvenance
  /** 显式未知项（媒体未描述、视频未转写、正文可能截断、评论为抽样等） */
  unknowns: string[]
  /** 确定性提示（长图、图集、广告、媒体归属等） */
  hints: string[]
}
