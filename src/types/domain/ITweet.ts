import type { VerificationType } from './IUser'

/**
 * ITweet 存档契约版本（v2，2026-10-21）。
 *
 * `ITweet` 是下游（Weibo-archiver web-v3 / monkey / CLI）的 UI 展示与磁盘存档终局契约
 * （ADR-007/008）。版本规则（与包版本解耦，见 website/reference/tweet-contract.md）：
 * - **v2 内**：字段只增不改——仅允许新增 optional 字段（读取方忽略未知键，非破坏）；
 * - **v3**：rename / remove / 类型或语义变更必须升契约版本，随包 major 发布，并提供迁移函数。
 *
 * v2 相对 v1 的破坏性变更：删除 `ITweet.textHtml` / `ITweetComment.textHtml`。
 */
export const TWEET_CONTRACT_VERSION = 2 as const

/**
 * `TWEET_CONTRACT_VERSION` 的字面量类型（当前仅 `2`）。
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
  /**
   * 纯文本正文。
   *
   * `statuses/show` 默认带 `isGetLongText=true`，长微博已是全文；
   * 若调用方显式关闭长文，可再经 `enrich({ includeLongText: true })` 补拉。
   */
  text: string
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

  /**
   * 转发链分层（仅转发微博；正文 `//@` 由近到远，`index` 0 = 当前微博）。
   *
   * 转发时附带的图片（reppic）不在 `pic_ids` / `pic_infos`，只在 `url_struct[]`；
   * 多层转发链会把各层配图全部聚合到顶层 `url_struct[]`。本字段用 `short_url`
   * 把图片挂回所属层，避免丢失「哪张图属于哪一层」的对应关系。
   */
  repostChain?: TweetRepostEntry[]

  // 网页卡片或视频卡片
  /** 网页卡片 / 视频卡片信息（链接预览等；无卡片时缺省） */
  pageInfo?: TweetPageCard

  /** 结构化附件（文章 / 投票 / 直播 / 抽奖）；无则缺省 */
  attachments?: TweetAttachment[]

  // 媒体内容
  /** 媒体列表（图片/视频/LivePhoto/GIF；无媒体时为空数组） */
  media: TweetMedia[]

  /** 定位信息（发布时选点；未选点缺省） */
  geo?: TweetGeo

  // ---- 2026-10-20 v1 新增 optional 字段（只增不改） ----

  /** 话题列表（上游 `topic_struct[].topic_title`；无话题缺省） */
  topics?: string[]
  /** 链接 / 超话卡片（上游 `url_struct[]`；无卡片缺省） */
  linkCards?: TweetLinkCard[]
  /** 阅读数（上游 `reads_count`；仅部分端点 / 自己可见时下发） */
  readCount?: number
  /** 编辑次数（上游 `edit_count`；未编辑或未下发时缺省） */
  editCount?: number
  /** 顶栏标题（上游 `title.text`，如「公开」「仅自己可见」；无则缺省） */
  title?: string
  /** 视频永久播放页（上游 `media_info.h5_url`；无视频缺省） */
  permanentVideoUrl?: string
  /** 是否原创（无 `retweeted_status`；转发为 `false`） */
  isOriginal?: boolean
  /** 微博网页永久链接（`https://weibo.com/<uid>/<mblogid>`） */
  sourceUrl?: string
  /** @ 用户（从 `text` HTML 的 `<a href="/n/...">` 锚点解析；无 @ 时缺省） */
  atUsers?: TweetAtUser[]
  /**
   * 视频播放数（上游 `page_info.media_info.online_users_number`）。
   *
   * 仅在 `online_users` 明确为「N次观看」时填写；直播的在线人数不是播放数，不映射。
   */
  playCount?: number
  /** 是否置顶（上游 `isTop === 1`；非置顶时缺省） */
  isTop?: boolean
  /** 音频 / 播客（上游 `page_info.object_type === 'podcast_audio'`；无音频时缺省） */
  audio?: TweetAudio[]

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
 *
 * D2（我的评论历史）在 v1 契约内**只新增 optional 字段**（下同），老读取方忽略即可：
 * `rootId` / `replyTo` / `floorNumber` / `totalReplies` / `liked` / `parentMblogId`。
 */
export interface ITweetComment {
  /** 评论 id（`idstr` 或 `id` 的字符串形式） */
  id: string
  /** 评论时间（上游 `created_at` 原样字符串） */
  createdAt: string
  /** 纯文本内容 */
  text: string
  /** 来源（如「微博网页版」） */
  source: string
  /** 点赞数 */
  likes: number
  /** 评论作者（简版用户信息） */
  user: TweetUser
  /** 楼中楼回复（递归同构；无回复时缺省） */
  replies?: ITweetComment[]
  /** 图片评论的配图（上游 `url_struct[].pic_infos`；无图时缺省） */
  pics?: TweetCommentPic[]

  // ---- D2 新增（全部 optional，v1 内只增不改） ----

  /**
   * 根评论 id（上游 `rootidstr` 优先，退回 `rootid`；上游未下发或缺省为 0 时本字段缺省）。
   *
   * 楼中楼回复归属的一级评论 id，用于把平铺的评论树还原成楼层。
   */
  rootId?: string
  /**
   * 被回复的评论（上游 `reply_comment`，递归归一化；无则缺省）。
   *
   * 与 `replies`（上游 `comments` 楼中楼列表）是两个独立字段：前者是「我回复了谁」，
   * 后者是「谁回复了这条」。
   */
  replyTo?: ITweetComment
  /** 楼层号（上游 `floor_number`；可为 0，上游未下发时缺省） */
  floorNumber?: number
  /** 楼中楼回复总数（上游 `total_number`；上游未下发时缺省） */
  totalReplies?: number
  /** 当前登录用户是否点赞过该评论（上游 `liked`；上游未下发时缺省，不伪造 false） */
  liked?: boolean
  /** 被评论微博的字母 id（上游内嵌 `status.mblogid`），用于回跳原微博 */
  parentMblogId?: string
}

/**
 * 评论配图（图片评论）。
 *
 * 上游图片不在评论顶层 `pic`，而是藏在 `url_struct[].pic_infos` 的「查看图片」卡片里；
 * `imageUrl` 与微博媒体一样是**临时签名 URL**（见 website/reference/tweet-contract.md §4）。
 */
export interface TweetCommentPic {
  /** 图片 id（`pic_infos` 键 / `pic_id`） */
  id: string
  /** 最大尺寸图片 URL（临时签名 URL） */
  imageUrl: string
  /** 像素宽度（缺省 0） */
  width: number
  /** 像素高度（缺省 0） */
  height: number
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
 * 转发链中的一层（`repostChain[]`）。
 *
 * 上游把转发链的各层正文拍平在顶层 `text_raw`（`//@name:正文`），图片则聚合在顶层
 * `url_struct[]`（`url_type: 39`）。本类型把「层」与「层内配图」重新配对：
 * 用 `url_struct[].short_url` 匹配该层正文里的 `http://t.cn/...` 短链。
 */
export interface TweetRepostEntry {
  /** 层级索引：`0` = 当前微博，`1..n` = `text` 中由近到远的 `//@` 层级 */
  index: number
  /** 该层作者昵称（0 层取 `user.name`；其余从 `//@name:` 解析；无法解析时缺省） */
  authorName?: string
  /** 该层正文（去掉 `//@` 前缀与图片短链；可能为空串） */
  text: string
  /** 该层配图（`url_struct[]` 的 reppic 条目；按 `pic_id` 去重；无图时为空数组） */
  media: TweetMedia[]
}

/**
 * 微博正文中被 @ 的用户（从 `text` HTML 锚点解析）。
 *
 * 上游没有结构化 `at_users` 字段；可稳定拿到的是锚点文本与 `href` 路径，
 * 数字 uid 不保证存在，因此 `id` 为可选。
 */
export interface TweetAtUser {
  /** 展示名（锚点文本，去掉前导 `@`） */
  name: string
  /** 主页路径标识（`href="/n/<name>"` / `href="/u/<uid>"` 的路径段） */
  username?: string
  /** 用户主页地址（`https://weibo.com/n/<username>` 或数字 uid 主页） */
  url?: string
}

/**
 * 音频 / 播客（`page_info.object_type === 'podcast_audio'`）。
 *
 * `url` 与视频直链一样是临时签名 URL；长期存档需及时下载或保存 `pageUrl`。
 */
export interface TweetAudio {
  /** 音频 id（`media_info.media_id` → `page_id` → `object_id`） */
  id: string
  /** 音频标题（`page_info.page_title`，缺省为空串） */
  title: string
  /** 音频直链（`media_info.stream_url`，临时 URL） */
  url: string
  /** 时长（秒） */
  duration?: number
  /** 永久播放页（`media_info.h5_url`） */
  pageUrl?: string
  /** 作者昵称（`media_info.author_info.screen_name`） */
  authorName?: string
  /** 作者 uid（`media_info.author_info.idstr` / `id`） */
  authorId?: string
}

/**
 * 微博正文里的结构化附件。
 *
 * 上游把不同格式放在不同位置：
 * - PC：`page_info`（article / hudongvote / live）；
 * - m 站：`url_objects[].object.object`；
 * - 抽奖：`url_struct[]` 的链接卡。
 *
 * `pageInfo` / `linkCards` 保持原样；本字段是它们的结构化视图，允许重复。
 */
export type TweetAttachment
  = | TweetArticleAttachment
    | TweetVoteAttachment
    | TweetLiveAttachment
    | TweetLotteryAttachment

interface TweetAttachmentBase {
  /** 附件类型 */
  kind: 'article' | 'vote' | 'live' | 'lottery'
  /** 上游 id（去掉 `1022:` 前缀；取不到用 page_id / mid） */
  id: string
  /** 上游 object_type（`article` / `hudongvote` / `live`；lottery 为合成值） */
  objectType: string
  /** 标题 / 问题 / 直播标题 */
  title: string
  /** 可点击的网页地址（http/https，优先上游 web URL；scheme 会被转换） */
  url: string
  /** 封面（临时 URL） */
  coverUrl?: string
  /** 数据来源，便于排障 */
  source: 'page_info' | 'url_objects' | 'url_struct'
}

/** 头条文章（正文默认不抓，`content` 仅显式抓取时存在）。 */
export interface TweetArticleAttachment extends TweetAttachmentBase {
  kind: 'article'
  /** 摘要（上游 `article_summary` / `page_desc`） */
  summary?: string
  /** 作者昵称 */
  author?: string
  /** 是否付费文章（上游 `ispay` / `is_paid`） */
  isPaid?: boolean
  /** 正文 HTML / 纯文本；默认缺省，见 `tweets.article()` */
  content?: string
  /** 正文是否可能被截断（付费、未登录、解析失败） */
  truncated?: boolean
}

/** 微博投票。票数是抓取时快照，不代表实时。 */
export interface TweetVoteAttachment extends TweetAttachmentBase {
  kind: 'vote'
  /** 是否多选 */
  multiSelect: boolean
  /** 最少选择数 */
  minChoices?: number
  /** 最多选择数 */
  maxChoices?: number
  /** 截止时间（unix 秒） */
  expiresAt?: number
  /** 总票数（m 站以 `vote_dynamic` 为准） */
  totalVotes?: number
  /** 上游状态码（语义未确认，原样保留） */
  state?: number
  /** 选项 */
  options: TweetVoteOption[]
}

/** 投票选项。 */
export interface TweetVoteOption {
  id: string
  text: string
  /** 票数（字符串转 number） */
  votes?: number
  /** 占比 0..1 */
  ratio?: number
  /** 当前登录用户是否选择（仅读） */
  selected?: boolean
  /** 选项配图（临时 URL；不并入 `media[]`） */
  imageUrl?: string
}

/** 微博直播 / 回放。stream / replay 地址是临时地址。 */
export interface TweetLiveAttachment extends TweetAttachmentBase {
  kind: 'live'
  /** 直播 id（上游 `1022:...`） */
  liveId: string
  /** 上游状态码（样本 3 = 已结束/有回放；语义未确认，原样保留） */
  status?: number
  /** 开播时间（unix 秒） */
  startedAt?: number
  /** 在线人数（抓取时快照） */
  viewerCount?: number
  /** 回放观看数（抓取时快照） */
  replayCount?: number
  /** 直播流（m3u8 / API 地址，临时） */
  streamUrl?: string
  /** 回放流（m3u8，临时） */
  replayUrl?: string
  /** 观看限制（上游 `watch_limit`，语义未确认） */
  watchLimit?: number
  /** 直播时长（秒；m 站 `duration`） */
  durationSeconds?: number
  /** 直播作者昵称（m 站 `author.display_name`） */
  authorName?: string
}

/** 抽奖链接卡（详情页未结构化）。 */
export interface TweetLotteryAttachment extends TweetAttachmentBase {
  kind: 'lottery'
  /** 抽奖所属微博 id */
  mid: string
  /** 抽奖详情页（HTML） */
  detailUrl: string
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
 * 过期后可经 SDK 重新拉取单条微博获取新 URL。详见 website/reference/tweet-contract.md。
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
 * 链接 / 超话卡片（`url_struct[]` 归一化）。
 */
export interface TweetLinkCard {
  /** 卡片标题（`url_title`；缺省为空串） */
  title: string
  /** 跳转地址（`h5_target_url` → `long_url` → `ori_url` fallback；缺省为空串） */
  url: string
  /** 展示用短地址（`short_url`） */
  shortUrl?: string
  /** 卡片 page id（`page_id`） */
  pageId?: string
  /** 对象类型（`object_type`） */
  objectType?: string
  /** 卡片图标（`url_type_pic`） */
  typePic?: string
  /** 规范网页地址（`long_url`，如 bilibili 视频页；未下发时缺省） */
  longUrl?: string
  /** 上游原始跳转（`ori_url`，可能是 `sinaweibo://` scheme；未下发时缺省） */
  oriUrl?: string
  /** 卡片类型码（`url_type`，如 39；`0` 也会保留，未下发时缺省） */
  urlType?: number
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
  /** 卡片对象 id（上游 `object_id`；未下发时缺省） */
  objectId?: string
  /** 卡片副标题 / 统计文案（上游 `content2`，如「812播放 74点赞 0弹幕」；空则缺省） */
  subtitle?: string
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
