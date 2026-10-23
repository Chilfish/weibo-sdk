import type { StatusShowResponse } from '../../endpoints/tweet'
import type { TweetLiker } from '~/types/domain/ILiker'
import type { ITweet, ITweetComment } from '~/types/domain/ITweet'
import type { StreamLimitOptions, StreamRangeOptions } from '~/utils/streamRange'

/** 一页点赞者（`likers` 返回值）。 */
export interface TweetLikersPageResult {
  /** 下一页页码（page 游标，从 1 开始） */
  page: number
  /** 是否可能还有下一页（空页 / 已达 total 时为 `false`） */
  hasMore: boolean
  /** 上游 `total_number`（可用时） */
  total?: number
  /** 本页归一化点赞者（已按用户 id 去重） */
  likers: TweetLiker[]
}

/** `likers` 的选项。 */
export interface TweetLikersOptions {
  /** 页码（从 1 开始；`< 1` / 非有限数按第一页处理） */
  page?: number
}

/** 点赞者流进度（每页触发一次）。 */
export interface TweetLikersStreamProgress {
  /** 微博 mid */
  mblogId: string
  /** 当前页码（1 基） */
  page: number
  /** 已产出的点赞者数（跨页去重后） */
  processed: number
  /** 本页去重前的条数 */
  pageSize: number
  /** 上游 `total_number`（可用时） */
  total?: number
}

/** `streamLikers` 的选项。 */
export interface TweetLikersStreamOptions extends TweetLikersOptions, StreamLimitOptions {
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；回调抛错不会中断流 */
  onProgress?: (progress: TweetLikersStreamProgress) => void | Promise<void>
}

/** 单条微博评论流进度（每页触发一次）。 */
export interface TweetCommentsStreamProgress {
  /** 微博 mblogId */
  mblogId: string
  /** 当前页码（从 1 开始） */
  page: number
  /** 已产出的评论数（跨页去重后） */
  processed: number
  /** 本页去重前的条数 */
  pageSize: number
  /** 上游 `total_number`（含楼中楼 / 可能含不可见评论，不能作为结束条件） */
  total?: number
}

/** `streamComments` / `streamReplies` 的选项。 */
export interface TweetCommentsStreamOptions extends StreamLimitOptions {
  /** 起始游标（上一页的 `max_id`；首屏省略） */
  maxId?: number
  /** 每页条数 */
  count?: number
  /** 排序方式（0=热度 / 1=时间） */
  flow?: 0 | 1
  /** 以哪个用户视角读取 */
  uid?: string
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；回调抛错不会中断流 */
  onProgress?: (progress: TweetCommentsStreamProgress) => void | Promise<void>
}

/** `comments` 的选项。 */
export interface TweetCommentsOptions {
  /** 上一页返回的分页游标（来自响应顶层 `max_id`；首屏省略） */
  maxId?: number
  /** 每页条数（上游忽略） */
  count?: number
  /** 排序方式（0=热度 / 1=时间；时间序必须使用数字 mid，方法内自动解析） */
  flow?: 0 | 1
  /** 以哪个用户视角读取（影响「我的赞」等字段） */
  uid?: string
  /** 是否读取二级评论（1 = 是；此时第一个参数必须是一级评论 id） */
  isReply?: number
  /** 可选透传的根评论 id（二级评论不需要） */
  rootId?: string | number
  /** 拉取层级（0 = 一级评论，1 = 二级评论） */
  fetchLevel?: number
}

/** `replies` 的选项。 */
export interface TweetRepliesOptions {
  /** 上一页返回的分页游标（首屏省略） */
  maxId?: number
  /** 每页条数 */
  count?: number
  /** 排序方式（0=热度 / 1=时间） */
  flow?: 0 | 1
  /** 以哪个用户视角读取 */
  uid?: string
}

/** 单条微博转发流进度（每页触发一次）。 */
export interface TweetRepostsStreamProgress {
  /** 微博 mblogId */
  mblogId: string
  /** 当前页码（从 1 开始） */
  page: number
  /** 已产出的转发数（跨页去重后） */
  processed: number
  /** 本页去重前的条数 */
  pageSize: number
  /** 上游 `total_number`（可用时） */
  total?: number
}

/** `streamReposts` 的选项。 */
export interface TweetRepostsStreamOptions extends StreamRangeOptions {
  /** 起始页码（从 1 开始） */
  page?: number
  /** 每页条数 */
  count?: number
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；回调抛错不会中断流 */
  onProgress?: (progress: TweetRepostsStreamProgress) => void | Promise<void>
}

/** 首页关注时间线流进度（每页触发一次）。 */
export interface TweetFriendTimelineStreamProgress {
  /** 当前页码（从 1 开始） */
  page: number
  /** 本页请求使用的 `max_id` 游标（首屏为起始游标） */
  cursor?: string
  /** 已产出的微博数（跨页去重后） */
  processed: number
  /** 本页去重前的条数 */
  pageSize: number
  /** 上游 `total_number`（实测为 2000 上限值，不能当作剩余条数） */
  total?: number
}

/** `streamFriendTimeline` 的选项。 */
export interface TweetFriendTimelineStreamOptions extends StreamRangeOptions {
  /** 起始 `max_id` 游标（缺省 = 第一页） */
  maxId?: string | number
  /** 只取比该微博 id 更新的条目（增量；只请求一页） */
  sinceId?: string | number
  /** 关注分组 id（可选；缺省 = 默认首页时间线） */
  listId?: string | number
  /** 分组过滤参数（浏览器与 `list_id` 同时发送；可选） */
  fid?: string | number
  /** 刷新标记（仅首屏透传） */
  refresh?: number
  /** 每页条数（上游实测忽略，固定 25） */
  count?: number
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；回调抛错不会中断流 */
  onProgress?: (progress: TweetFriendTimelineStreamProgress) => void | Promise<void>
}

/** `streamByUserId` 的选项。 */
export interface TweetUserTimelineStreamOptions extends StreamRangeOptions {
  /** 起始页码（从 1 开始；缺省 = 第一页） */
  page?: number
  /** 每页条数（缺省由上游决定） */
  count?: number
  /** 最多翻页数（默认不限） */
  maxPages?: number
}

/** `listByUserId` 的选项。 */
export interface TweetUserTimelineListOptions {
  /** 页码（从 1 开始；缺省 = 第一页） */
  page?: number
  /** 每页条数（缺省由上游决定） */
  count?: number
}

/** `getReposts` 的选项。 */
export interface TweetRepostsListOptions {
  /** 页码（从 1 开始；缺省 = 第一页） */
  page?: number
  /** 每页条数（上游实测忽略） */
  count?: number
}

/** 一页评论（`comments` / `replies` 的返回值）。 */
export interface TweetCommentsPageResult {
  /** 本页归一化评论（保持上游顺序，楼中楼在 `comment.replies`） */
  comments: ITweetComment[]
  /** 下一页游标（上游顶层 `max_id`；`0` = 到底） */
  cursor: number
  /** 是否可能还有下一页 */
  hasMore: boolean
  /** 上游 `total_number`（含楼中楼 / 可能含不可见评论，仅作参考） */
  total?: number
  /** 上游提示文案（如「博主已开启防火墙」） */
  notice?: string
}

/** 一页转发（`getReposts` 的返回值）。 */
export interface TweetRepostsPageResult {
  /** 本页归一化转发微博 */
  reposts: ITweet[]
  /** 本次请求的页码 */
  page: number
  /** 是否可能还有下一页 */
  hasMore: boolean
  /** 上游 `total_number`（可用时） */
  total?: number
  /** 上游 `max_page`（可用时） */
  maxPage?: number
}

/** 一页按日期检索结果（`searchByDate` 的返回值）。 */
export interface TweetSearchByDatePageResult {
  /** 本页归一化微博 */
  tweets: ITweet[]
  /** 本次请求的页码 */
  page: number
  /** 上游报告的总数（`data.total`，number / 字符串均已解析） */
  total?: number
  /** 是否可能还有下一页 */
  hasMore: boolean
}

/** `listFriendTimeline` 的选项。 */
export interface TweetFriendTimelineListOptions {
  /** 翻旧页游标（上一页 `maxId`；首屏省略） */
  maxId?: string | number
  /** 增量过滤（只返回比该微博 id 更新的条目；单页） */
  sinceId?: string | number
  /** 关注分组 id（可选） */
  listId?: string | number
  /** 分组过滤参数（可选，与 `listId` 同时发送） */
  fid?: string | number
  /** 每页条数（上游实测忽略） */
  count?: number
  /** 刷新标记（仅首屏透传） */
  refresh?: number
}

/** `searchByDate` 的选项。 */
export interface TweetSearchByDateOptions {
  /** 页码（从 1 开始；缺省 = 第一页） */
  page?: number
  /** 关键词（个人主页内搜索；缺省 = 不按关键词过滤） */
  q?: string
  /** 时间下界（unix 秒或 `YYYY-MM-DD` / `YYYYMMDD`，含当天） */
  starttime?: number | string
  /** 时间上界（unix 秒或 `YYYY-MM-DD` / `YYYYMMDD`，含当天） */
  endtime?: number | string
  /** 是否包含原创（0 / 1） */
  hasori?: number
  /** 是否包含转发（0 / 1） */
  hasret?: number
  /** 是否包含纯文字（0 / 1） */
  hastext?: number
  /** 是否包含图片（0 / 1） */
  haspic?: number
  /** 是否包含视频（0 / 1） */
  hasvideo?: number
  /** 是否包含音乐（0 / 1） */
  hasmusic?: number
}

/**
 * 一页微博的归一化结果（`listByUserId` / `listFriendTimeline` 的返回值）。
 *
 * 两种游标互斥，按端点的分页机制填充：
 * - `page`：page 游标端点（mymblog），值为**下一页**页码
 * - `maxId`：max_id 游标端点（friendstimeline），值为**下一页**游标（翻旧页）
 */
export interface TweetPageResult {
  /** 下一页页码（page 游标端点，如 mymblog；无 page 游标时省略） */
  page?: number
  /** 下一页游标（max_id 游标端点，如 friendstimeline；缺省 = 无更多） */
  maxId?: string
  /** 是否可能还有下一页（`false` 时调用方可以停止翻页） */
  hasMore: boolean
  /** 上游 `total_number`（可用时；friendstimeline 实测恒为 2000 上限值，不代表剩余条数） */
  total?: number
  /**
   * 是否为不完整采样。
   *
   * guest 模式只能拿 m 站第一页，此时为 `true` 且 `hasMore` 恒为 `false`。
   */
  partial?: boolean
  /** 本页归一化后的微博（已过滤广告等无效项） */
  tweets: ITweet[]
}

/**
 * `enrich` 的可选行为开关。
 */
export interface TweetEnrichOptions {
  /** `statuses/show` 的 isGetLongText 参数（默认 true） */
  isGetLongText?: boolean
  /** 是否额外请求 `longtext` 端点补拉长微博全文（默认 false） */
  includeLongText?: boolean
}

/**
 * enrich 结果（P1-9）：raw 与归一化模型一起返回，调用方自行决定是否落盘。
 *
 * `raw` 保留 `statuses/show` 的 passthrough 字段（未被 `ITweet` 映射的字段也在），
 * `tweet` 与 `getByMblogId` 同构；二者都不改变 `ITweet` v1 契约。
 */
export interface TweetEnrichResult {
  /** 归一化微博（与 `getByMblogId` 同构） */
  tweet: ITweet
  /** `statuses/show` 原始响应（passthrough，含未映射字段），供下游自行落盘 */
  raw: StatusShowResponse
  /** 长微博全文（仅 `includeLongText: true` 时请求；优先 `longTextContent_raw`） */
  longText?: string
}
