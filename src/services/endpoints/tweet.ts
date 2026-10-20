import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

const IdSchema = z.union([z.string(), z.number()])

// pic_infos 内层结构（基于真实 fixture：tests/fixtures/raw/comments.json、favorites_p1.json）
// width/height 实际为 number | string；size.type 可为 null / '' / 'pic'
const PicSizeSchema = z.object({
  type: z.union([z.string(), z.null()]).optional(),
  url: z.string().optional(),
  cut_type: z.number().optional(),
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  croped: z.boolean().optional(),
}).passthrough()

export const PicInfoSchema = z.object({
  thumbnail: PicSizeSchema.optional(),
  bmiddle: PicSizeSchema.optional(),
  large: PicSizeSchema.optional(),
  woriginal: PicSizeSchema.optional(),
  original: PicSizeSchema.optional(),
  largest: PicSizeSchema.optional(),
  mw2000: PicSizeSchema.optional(),
  largecover: PicSizeSchema.optional(),
  focus_point: z.object({
    left: z.number().optional(),
    top: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }).optional(),
  object_id: z.string().optional(),
  pic_id: z.string().optional(),
  video: z.string().optional(), // livephoto / normalize 读取
  photo_tag: z.number().optional(),
  type: z.string().optional(), // 'pic' | 'gif' | ...
  pic_status: z.number().optional(),
}).passthrough()

// annotations 行为多变：异构数组（单键对象 {photo_sub_type}、{source_text, phone_id}、嵌套数组等），只约束「必须是数组」
const AnnotationsSchema = z.array(z.unknown()).optional()

const MyMblogArgsSchema = z.object({
  uid: z.string(),
  since_id: z.union([z.string(), z.number()]).optional(),
  count: z.number().optional(),
  page: z.number().optional(),
  feature: z.number().optional(),
}).strict()

const StatusShowArgsSchema = z.object({
  id: z.string(),
  isGetLongText: z.boolean(),
}).strict()

export const MyMBlogItemSchema: z.ZodType<any> = z.object({
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  mblogid: z.string(),
  mid: z.string().optional(),
  created_at: z.string().optional(),
  text: z.string().optional(),
  text_raw: z.string().optional(),
  region_name: z.string().optional(),
  source: z.string().optional(),
  isAd: z.boolean().optional(),
  isLongText: z.boolean().optional(),
  visible: z.object({
    type: z.number(),
    list_id: z.number().optional(),
  }).passthrough().optional(),
  user: z.object({
    id: IdSchema.optional(),
    idstr: z.string().optional(),
    screen_name: z.string().optional(),
    avatar_hd: z.string().optional(),
    avatar_large: z.string().optional(),
    profile_image_url: z.string().optional(),
    verified: z.boolean().optional(),
    verified_type: z.number().optional(),
  }).passthrough().nullable().optional(),
  attitudes_count: z.number().optional(),
  comments_count: z.number().optional(),
  reposts_count: z.number().optional(),
  pic_ids: z.array(z.string()).optional(),
  pic_infos: z.record(z.string(), PicInfoSchema).optional(),
  annotations: AnnotationsSchema,
  mix_media_info: z.record(z.string(), z.unknown()).optional(),
  page_info: z.record(z.string(), z.unknown()).optional(),
  geo: z.union([z.record(z.string(), z.unknown()), z.string()]).nullable().optional(),
  tag_struct: z.array(z.unknown()).optional(),
  retweeted_status: z.lazy((): z.ZodType<any> => MyMBlogItemSchema).nullable().optional(),
}).passthrough()

const MyMblogResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    // 2026-10-20 实测：since_id 恢复为可用游标（等价 page），形态为 number 或带后缀的 string（如 "...kp2"）；
    // 历史样本曾恒为 ""。翻到底时缺省。两种形态都必须接受，避免 Number 强转截断大 ID。
    since_id: z.union([z.string(), z.number()]).optional(),
    list: z.array(MyMBlogItemSchema),
    status_visible: z.number().optional(),
    bottom_tips_visible: z.boolean().optional(),
    bottom_tips_text: z.string().optional(),
    topicList: z.array(z.unknown()).optional(),
    // 2026-10-20 实测：total 返回真实总数（历史样本曾恒为 -1）；翻到底时缺省
    total: z.number().optional(),
  }),
})

export type MyMblogResponse = z.infer<typeof MyMblogResponseSchema>

const StatusShowResponseSchema: z.ZodType<any> = z.object({
  ok: z.number().optional(),
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  mblogid: z.string(),
  mid: z.string().optional(),
  created_at: z.string().optional(),
  text: z.string().optional(),
  text_raw: z.string().optional(),
  region_name: z.string().optional(),
  source: z.string().optional(),
  visible: z.object({
    type: z.number(),
    list_id: z.number().optional(),
  }).passthrough().optional(),
  user: z.object({
    id: IdSchema.optional(),
    idstr: z.string().optional(),
    screen_name: z.string().optional(),
    avatar_hd: z.string().optional(),
    avatar_large: z.string().optional(),
    profile_image_url: z.string().optional(),
    verified: z.boolean().optional(),
    verified_type: z.number().optional(),
  }).passthrough().nullable().optional(),
  attitudes_count: z.number().optional(),
  comments_count: z.number().optional(),
  reposts_count: z.number().optional(),
  pic_ids: z.array(z.string()).optional(),
  pic_infos: z.record(z.string(), PicInfoSchema).optional(),
  annotations: AnnotationsSchema,
  mix_media_info: z.record(z.string(), z.unknown()).optional(),
  page_info: z.record(z.string(), z.unknown()).optional(),
  geo: z.union([z.record(z.string(), z.unknown()), z.string()]).nullable().optional(),
  tag_struct: z.array(z.unknown()).optional(),
  retweeted_status: z.lazy((): z.ZodType<any> => StatusShowResponseSchema).nullable().optional(),
}).passthrough().superRefine((val, ctx) => {
  if (val.id === undefined && !val.idstr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tweet.id or tweet.idstr is required',
      path: ['id'],
    })
  }
  if (val.user && val.user.id === undefined && !val.user.idstr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tweet.user.id or tweet.user.idstr is required',
      path: ['user', 'id'],
    })
  }
})

export type StatusShowResponse = z.infer<typeof StatusShowResponseSchema>

export const myMblogSpec: EndpointSpec<'TWEET_MYMBLOG', typeof MyMblogArgsSchema> = defineEndpoint({
  resourceType: 'TWEET_MYMBLOG',
  endpoint: 'ajax/statuses/mymblog',
  argsSchema: MyMblogArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/mymblog',
    headers: {
      referer: `https://weibo.com/u/${uid}`,
    },
  }),
  // 用户时间线：guest 下改走 m 站容器（见 mobile.ts），PC 端点需要 Cookie
  auth: 'cookie',
  okPolicy: { mode: 'none' },
  schema: MyMblogResponseSchema,
})

// ---- Comments ----

const BuildCommentsArgsSchema = z.object({
  id: z.string(),
  is_reload: z.number().optional(), // 实测固定 1
  is_show_bulletin: z.number().optional(),
  is_mix: z.number().optional(),
  // 注意：不要传 type=feed。2026-10-20 实测带该参数时上游只返回首屏 3 条，
  // 且 total_number / max_id 看起来正常（静默降级）；浏览器真实请求不带 type。
  count: z.number().optional(),
  uid: z.string().optional(),
  fetch_level: z.number().optional(),
  // 二级评论（D13）：is_reply=1 + fetch_level=1，且 id=<一级评论 id>（不是 mblogid）
  is_reply: z.number().optional(),
  rootid: z.union([z.string(), z.number()]).optional(),
  flow: z.number().optional(),
  max_id: z.number().optional(),
}).strict()

export type BuildCommentsArgs = z.infer<typeof BuildCommentsArgsSchema>

// 图片评论（真实样本：comments.json / comments_pic_multi.json）：配图在 url_struct[].pic_infos，
// 多图评论可能重复下发同一 pic_infos（归一化按 pic_id 去重）。
const CommentUrlStructSchema = z.object({
  url_title: z.string().optional(),
  short_url: z.string().optional(),
  long_url: z.string().optional(),
  ori_url: z.string().optional(),
  h5_target_url: z.string().optional(),
  pic_ids: z.array(z.string()).optional(),
  pic_infos: z.record(z.string(), PicInfoSchema).optional(),
}).passthrough()

const CommentItemSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  mid: z.string().optional(),
  created_at: z.string().optional(),
  text: z.string().optional(),
  text_raw: z.string().optional(),
  source: z.string().optional(),
  like_counts: z.number().optional(),
  liked: z.boolean().optional(),
  floor_number: z.number().optional(),
  total_number: z.number().optional(),
  max_id: z.number().optional(),
  rootid: z.number().optional(),
  rootidstr: z.string().optional(),
  pic_num: z.number().optional(),
  mix_media_ids: z.array(z.string()).optional(),
  url_struct: z.array(CommentUrlStructSchema).optional(),
  user: z.object({
    id: IdSchema.optional(),
    idstr: z.string().optional(),
    screen_name: z.string().optional(),
    profile_image_url: z.string().optional(),
    avatar_hd: z.string().optional(),
    avatar_large: z.string().optional(),
    verified: z.boolean().optional(),
    verified_type: z.number().optional(),
  }).passthrough().nullable().optional(),
  comments: z.array(z.lazy(() => CommentItemSchema)).optional(),
}).passthrough())

const BuildCommentsResponseSchema = z.object({
  ok: z.number(),
  filter_group: z.array(z.object({
    param: z.string(),
    scheme: z.string().optional(),
    title: z.string(),
    isDefault: z.number().optional(),
  }).passthrough()).optional(),
  data: z.array(CommentItemSchema),
  // 顶层评论的 total_number 包含楼中楼 / 可能包含不可见评论，不能当作「还剩多少条顶层评论」。
  total_number: z.number().optional(),
  // 翻到底：max_id=0。注意 hot 排序可能先返回空页（max_id 仍非 0），需按空页停止。
  max_id: z.number().optional(),
  // 部分可见提示：如「博主已开启防火墙，部分内容暂不展示」（此时 data 会少于 total_number）。
  trendsText: z.string().optional(),
  tip_msg: z.string().optional(),
}).passthrough()

export type BuildCommentsResponse = z.infer<typeof BuildCommentsResponseSchema>

export const buildCommentsSpec: EndpointSpec<'TWEET_COMMENTS', typeof BuildCommentsArgsSchema> = defineEndpoint({
  resourceType: 'TWEET_COMMENTS',
  endpoint: 'ajax/statuses/buildComments',
  argsSchema: BuildCommentsArgsSchema,
  buildResource: ({ id }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/buildComments',
    headers: {
      referer: `https://weibo.com/detail/${id}`,
    },
  }),
  // 评论首屏公开可读：访客 token 可翻页（研究实测 page 型分页有效）
  auth: 'guest',
  okPolicy: { mode: 'require_ok_1' },
  schema: BuildCommentsResponseSchema,
})

// ---- Friendstimeline (Home Feed) ----

// 首页「最新微博」关注时间线（2026-10-20 OpenCLI 实测，uid 7679065628）
// - 首屏：refresh=4&since_id=0，返回按时间倒序的 25 条；
// - 翻旧页：max_id=<上一页响应 max_id>（含游标本身，需去重），响应 max_id 是下一页游标；
// - 增量：since_id=<已知最新微博 id> 只返回更新条目（单页，最多 25 条）；
// - count 被上游忽略（传 5/10/50/100 均固定返回 25）；
// - list_id / fid 都可用（浏览器同时带；缺省同样返回默认首页时间线）；
// - 到底：statuses: []、max_id/since_id 均为 0。
const FriendstimelineArgsSchema = z.object({
  list_id: z.union([z.string(), z.number()]).optional(),
  fid: z.union([z.string(), z.number()]).optional(), // 浏览器带 fid（= list_id），可选
  refresh: z.number().optional(),
  since_id: z.union([z.string(), z.number()]).optional(), // 增量过滤（不是翻页游标）
  max_id: z.union([z.string(), z.number()]).optional(), // 翻旧页游标
  count: z.number().optional(), // 实测被忽略，固定 25
}).strict()

export type FriendstimelineArgs = z.infer<typeof FriendstimelineArgsSchema>

const FriendstimelineResponseSchema = z.object({
  ok: z.number(),
  statuses: z.array(MyMBlogItemSchema),
  total_number: z.number().optional(), // 实测 2000（上限值），不能当作剩余条数
  since_id: z.union([z.string(), z.number()]).optional(),
  max_id: z.union([z.string(), z.number()]).optional(),
  since_id_str: z.string().optional(),
  max_id_str: z.string().optional(),
}).passthrough()

export type FriendstimelineResponse = z.infer<typeof FriendstimelineResponseSchema>

export const friendstimelineSpec: EndpointSpec<'TWEET_FRIENDTIMELINE', typeof FriendstimelineArgsSchema> = defineEndpoint({
  resourceType: 'TWEET_FRIENDTIMELINE',
  endpoint: 'ajax/feed/friendstimeline',
  argsSchema: FriendstimelineArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/feed/friendstimeline',
    headers: {
      referer: 'https://weibo.com/',
    },
  }),
  // 首页关注时间线是账号级数据：访客 token 无法读取
  auth: 'cookie',
  okPolicy: { mode: 'require_ok_1' },
  schema: FriendstimelineResponseSchema,
})

export const statusShowSpec: EndpointSpec<'TWEET_SHOW', typeof StatusShowArgsSchema> = defineEndpoint({
  resourceType: 'TWEET_SHOW',
  endpoint: 'ajax/statuses/show',
  argsSchema: StatusShowArgsSchema,
  buildResource: ({ id }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/show',
    headers: {
      referer: `https://weibo.com/detail/${id}`,
    },
  }),
  // 单条微博公开可读：访客 token 可用
  auth: 'guest',
  okPolicy: { mode: 'require_ok_1' },
  schema: StatusShowResponseSchema,
})

// ---- Repost Timeline (转发列表) ----

// 真实 fixture：repost_timeline.json / repost_timeline_p2.json
// data 为微博数组（与 MyMBlogItemSchema 同构，转发本身也是微博）；next_cursor 实测分页无效，用 page
const RepostTimelineArgsSchema = z.object({
  id: z.string(),
  page: z.number().optional(),
  count: z.number().optional(),
  next_cursor: z.number().optional(),
}).strict()

const RepostTimelineResponseSchema = z.object({
  ok: z.number(),
  data: z.array(MyMBlogItemSchema),
  total_number: z.number().optional(),
  max_page: z.number().optional(),
  next_cursor: z.number().optional(),
  empty_tip: z.string().optional(),
}).passthrough()

export type RepostTimelineResponse = z.infer<typeof RepostTimelineResponseSchema>

export const repostTimelineSpec: EndpointSpec<'TWEET_REPOST_TIMELINE', typeof RepostTimelineArgsSchema> = defineEndpoint({
  resourceType: 'TWEET_REPOST_TIMELINE',
  endpoint: 'ajax/statuses/repostTimeline',
  argsSchema: RepostTimelineArgsSchema,
  buildResource: ({ id }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/repostTimeline',
    headers: {
      referer: `https://weibo.com/detail/${id}`,
    },
  }),
  // 转发列表公开可读：访客 token 可用
  auth: 'guest',
  okPolicy: { mode: 'require_ok_1' },
  schema: RepostTimelineResponseSchema,
})

// ---- Longtext ----

const LongtextArgsSchema = z.object({
  id: z.string(),
}).strict()

const LongtextResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    longTextContent: z.string().optional(),
    topic_struct: z.array(z.unknown()).optional(),
    url_struct: z.array(z.unknown()).optional(),
    isMarkdown: z.boolean().optional(),
    longTextContent_raw: z.string().optional(),
  }).passthrough(),
}).passthrough()

export type LongtextResponse = z.infer<typeof LongtextResponseSchema>

export const longtextSpec: EndpointSpec<'TWEET_LONGTEXT', typeof LongtextArgsSchema> = defineEndpoint({
  resourceType: 'TWEET_LONGTEXT',
  endpoint: 'ajax/statuses/longtext',
  argsSchema: LongtextArgsSchema,
  buildResource: ({ id }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/longtext',
    headers: {
      referer: `https://weibo.com/detail/${id}`,
    },
  }),
  // 长文正文公开可读：访客 token 可用
  auth: 'guest',
  okPolicy: { mode: 'require_ok_1' },
  schema: LongtextResponseSchema,
})

// ---- Search Profile (Date Range Search) ----

const SearchProfileArgsSchema = z.object({
  uid: z.string(),
  page: z.number().optional(),
  // 个人主页内关键词搜索（D12，与日期窗口可组合；空串等同不过滤）
  q: z.string().optional(),
  // 实测为 unix 秒（如 1790784000）；字符串由 TweetService.searchByDate 在请求前换算（上游会忽略日期字符串）。
  starttime: z.union([z.number(), z.string()]).optional(),
  endtime: z.union([z.number(), z.string()]).optional(),
  hasori: z.number().optional(),
  hasret: z.number().optional(),
  hastext: z.number().optional(),
  haspic: z.number().optional(),
  hasvideo: z.number().optional(),
  hasmusic: z.number().optional(),
}).strict()

export type SearchProfileArgs = z.infer<typeof SearchProfileArgsSchema>

const SearchProfileResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    list: z.array(MyMBlogItemSchema),
    total: z.union([z.number(), z.string()]), // 真实 API 返回 string（如 "185"）
    absstr: z.string().optional(),
  }),
})

export type SearchProfileResponse = z.infer<typeof SearchProfileResponseSchema>

export const searchProfileSpec: EndpointSpec<'TWEET_SEARCHPROFILE', typeof SearchProfileArgsSchema> = defineEndpoint({
  resourceType: 'TWEET_SEARCHPROFILE',
  endpoint: 'ajax/statuses/searchProfile',
  argsSchema: SearchProfileArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/searchProfile',
    headers: {
      referer: `https://weibo.com/u/${uid}`,
    },
  }),
  // 个人主页内检索：访客 token 实测被静默门控（返回空列表），保持 Cookie 要求
  auth: 'cookie',
  okPolicy: { mode: 'require_ok_1' },
  schema: SearchProfileResponseSchema,
})
