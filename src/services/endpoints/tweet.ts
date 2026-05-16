import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

const IdSchema = z.union([z.string(), z.number()])

const MyMblogArgsSchema = z.object({
  uid: z.string(),
  since_id: z.number().optional(),
  count: z.number().optional(),
  page: z.number().optional(),
  feature: z.number().optional(),
}).strict()

const StatusShowArgsSchema = z.object({
  id: z.string(),
  isGetLongText: z.boolean(),
}).strict()

const MyMBlogItemSchema = z.object({
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
  }).passthrough(),
  attitudes_count: z.number().optional(),
  comments_count: z.number().optional(),
  reposts_count: z.number().optional(),
  pic_ids: z.array(z.string()).optional(),
  pic_infos: z.record(z.unknown()).optional(),
  mix_media_info: z.record(z.unknown()).optional(),
  page_info: z.record(z.unknown()).optional(),
  geo: z.record(z.unknown()).nullable().optional(),
  tag_struct: z.array(z.unknown()).optional(),
  retweeted_status: z.lazy(() => MyMBlogItemSchema).nullable().optional(),
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

const StatusShowResponseSchema = z.object({
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
  }).passthrough(),
  attitudes_count: z.number().optional(),
  comments_count: z.number().optional(),
  reposts_count: z.number().optional(),
  pic_ids: z.array(z.string()).optional(),
  pic_infos: z.record(z.unknown()).optional(),
  mix_media_info: z.record(z.unknown()).optional(),
  page_info: z.record(z.unknown()).optional(),
  geo: z.record(z.unknown()).nullable().optional(),
  tag_struct: z.array(z.unknown()).optional(),
  retweeted_status: z.lazy(() => StatusShowResponseSchema).nullable().optional(),
}).passthrough().superRefine((val, ctx) => {
  if (val.id === undefined && !val.idstr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tweet.id or tweet.idstr is required',
      path: ['id'],
    })
  }
  if (val.user.id === undefined && !val.user.idstr) {
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
  }).passthrough(),
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
  since_id: z.number().optional(),
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
