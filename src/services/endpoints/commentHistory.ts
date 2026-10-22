import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'
import { PicInfoSchema } from './tweet'

const IdSchema = z.union([z.string(), z.number()])
const CursorSchema = z.union([z.number(), z.string()])

const HistoryUserSchema = z.object({
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  screen_name: z.string().optional(),
  avatar_hd: z.string().optional(),
  avatar_large: z.string().optional(),
  profile_image_url: z.string().optional(),
  verified: z.boolean().optional(),
  verified_type: z.number().optional(),
}).loose().nullable().optional()

// 评论内嵌的「被评论微博」；与 mymblog 条目同构，只声明代码实际访问的字段。
const CommentedStatusSchemaBase = z.object({
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  mid: z.string().optional(),
  mblogid: z.string(),
  created_at: z.string().optional(),
  text: z.string().optional(),
  text_raw: z.string().optional(),
  source: z.string().optional(),
  region_name: z.string().optional(),
  visible: z.object({
    type: z.number(),
    list_id: z.number().optional(),
  }).loose().optional(),
  user: HistoryUserSchema,
  attitudes_count: z.number().optional(),
  comments_count: z.number().optional(),
  reposts_count: z.number().optional(),
  pic_ids: z.array(z.string()).optional(),
  pic_infos: z.record(z.string(), PicInfoSchema).optional(),
  annotations: z.array(z.unknown()).optional(),
  page_info: z.record(z.string(), z.unknown()).optional(),
}).loose()

type CommentedStatus = z.infer<typeof CommentedStatusSchemaBase> & {
  retweeted_status?: CommentedStatus | null
}

const CommentedStatusSchema: z.ZodType<CommentedStatus> = CommentedStatusSchemaBase.extend({
  retweeted_status: z.lazy(() => CommentedStatusSchema).nullable().optional(),
})

// 被回复的评论（楼中楼）；递归同构，字段全部 optional 以兼容缺省变种。
const ReplyCommentSchemaBase = z.object({
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  mid: z.string().optional(),
  rootid: IdSchema.optional(),
  rootidstr: z.string().optional(),
  floor_number: z.number().optional(),
  created_at: z.string().optional(),
  text: z.string().optional(),
  text_raw: z.string().optional(),
  source: z.string().optional(),
  like_counts: z.number().optional(),
  liked: z.boolean().optional(),
  user: HistoryUserSchema,
}).loose()

type ReplyComment = z.infer<typeof ReplyCommentSchemaBase> & {
  reply_comment?: ReplyComment | null
}

const ReplyCommentSchema: z.ZodType<ReplyComment> = ReplyCommentSchemaBase.extend({
  reply_comment: z.lazy(() => ReplyCommentSchema).nullable().optional(),
})

// 真实 fixture：my_comments_p1.json / my_comments_p2.json / my_comments_end.json
export const MyCommentItemSchema = z.object({
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  mid: z.string().optional(),
  rootid: IdSchema.optional(),
  rootidstr: z.string().optional(),
  floor_number: z.number().optional(),
  created_at: z.string().optional(),
  text: z.string().optional(),
  text_raw: z.string().optional(),
  source: z.string().optional(),
  like_counts: z.number().optional(),
  liked: z.boolean().optional(),
  user: HistoryUserSchema,
  status: CommentedStatusSchema,
  reply_comment: ReplyCommentSchema.nullable().optional(),
  page_info: z.record(z.string(), z.unknown()).optional(),
}).loose()

export type MyCommentItem = z.infer<typeof MyCommentItemSchema>

const MyCommentsArgsSchema = z.object({
  // 真实翻页参数：max_id = 上一页 data.next_cursor；page 也生效（1 基），二者等价。
  max_id: z.number().optional(),
  page: z.number().optional(),
}).strict()

export type MyCommentsArgs = z.infer<typeof MyCommentsArgsSchema>

// GET /ajax/message/myCmt：data.comments 为评论列表；next_cursor === 0 表示到底。
const MyCommentsResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    comments: z.array(MyCommentItemSchema),
    hasvisible: z.boolean().optional(),
    previous_cursor: CursorSchema.optional(),
    next_cursor: CursorSchema,
    previous_cursor_str: z.string().optional(),
    next_cursor_str: z.string().optional(),
    total_number: z.number().optional(),
    interval: z.number().optional(),
    extend_card: z.number().optional(),
    messType: z.string().optional(),
  }).loose(),
}).loose()

export type MyCommentsResponse = z.infer<typeof MyCommentsResponseSchema>

export const myCommentsSpec: EndpointSpec<'COMMENTS_MINE', typeof MyCommentsArgsSchema> = defineEndpoint({
  resourceType: 'COMMENTS_MINE',
  endpoint: 'ajax/message/myCmt',
  argsSchema: MyCommentsArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/message/myCmt',
    headers: { referer: 'https://weibo.com/' },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: MyCommentsResponseSchema,
})
