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

const MyMBlogItemSchema: z.ZodType<any> = z.object({
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
    since_id: z.string(),
    list: z.array(MyMBlogItemSchema),
    status_visible: z.number().optional(),
    bottom_tips_visible: z.boolean().optional(),
    bottom_tips_text: z.string().optional(),
    topicList: z.array(z.unknown()).optional(),
    total: z.number(),
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
  okPolicy: { mode: 'none' },
  schema: MyMblogResponseSchema,
})

// ---- Comments ----

const BuildCommentsArgsSchema = z.object({
  id: z.string(),
  is_reload: z.boolean().optional(),
  is_show_bulletin: z.number().optional(),
  is_mix: z.number().optional(),
  count: z.number().optional(),
  uid: z.string().optional(),
  fetch_level: z.number().optional(),
  flow: z.number().optional(),
  max_id: z.number().optional(),
}).strict()

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
  total_number: z.number().optional(),
  max_id: z.number().optional(),
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
  okPolicy: { mode: 'require_ok_1' },
  schema: BuildCommentsResponseSchema,
})

// ---- Friendstimeline (Home Feed) ----

const FriendstimelineArgsSchema = z.object({
  list_id: z.string().optional(),
  refresh: z.number().optional(),
  since_id: z.union([z.string(), z.number()]).optional(),
  count: z.number().optional(),
}).strict()

const FriendstimelineResponseSchema = z.object({
  ok: z.number(),
  statuses: z.array(MyMBlogItemSchema),
  total_number: z.number().optional(),
  since_id: z.number().optional(),
  max_id: z.number().optional(),
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
  okPolicy: { mode: 'require_ok_1' },
  schema: LongtextResponseSchema,
})

// ---- Search Profile (Date Range Search) ----

const SearchProfileArgsSchema = z.object({
  uid: z.string(),
  page: z.number().optional(),
  starttime: z.string().optional(),
  endtime: z.string().optional(),
  hasori: z.number().optional(),
  hasret: z.number().optional(),
  hastext: z.number().optional(),
  haspic: z.number().optional(),
  hasvideo: z.number().optional(),
  hasmusic: z.number().optional(),
}).strict()

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
  okPolicy: { mode: 'require_ok_1' },
  schema: SearchProfileResponseSchema,
})
