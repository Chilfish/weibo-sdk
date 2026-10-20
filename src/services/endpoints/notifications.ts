import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'
import { MyCommentItemSchema } from './commentHistory'
import { MyMBlogItemSchema } from './tweet'

const IdSchema = z.union([z.string(), z.number()])
const CursorSchema = z.union([z.number(), z.string()])

const NotificationUserSchema = z.object({
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  screen_name: z.string().optional(),
  name: z.string().optional(),
  profile_image_url: z.string().optional(),
  avatar_hd: z.string().optional(),
  avatar_large: z.string().optional(),
  verified: z.boolean().optional(),
  verified_type: z.number().optional(),
}).passthrough()

/**
 * 消息中心分页参数（`/ajax/message/cmt` 与 `/ajax/message/attitudes` 共用）。
 *
 * 实测（2026-10-20）：`page=<n>` 与 `max_id=<上一页 data.next_cursor>` 等价；
 * `cursor=<id>` 被忽略；到底时 `next_cursor: 0` + 空数组。
 */
const MessageArgsSchema = z.object({
  max_id: z.number().optional(),
  page: z.number().optional(),
}).strict()

export type MessageArgs = z.infer<typeof MessageArgsSchema>

// 真实 fixture：message_cmt_p1.json / message_cmt_p2.json / message_cmt_end.json
const MessageCommentsResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    comments: z.array(MyCommentItemSchema),
    next_cursor: CursorSchema.optional(),
    previous_cursor: CursorSchema.optional(),
    total_number: z.number().optional(),
    hasvisible: z.boolean().optional(),
    interval: z.number().optional(),
  }).passthrough(),
}).passthrough()

export type MessageCommentsResponse = z.infer<typeof MessageCommentsResponseSchema>

// 真实 fixture：message_attitudes_p1.json / message_attitudes_p2.json / message_attitudes_end.json
const AttitudeItemSchema = z.object({
  id: IdSchema.optional(),
  idStr: z.string().optional(),
  created_at: z.string().optional(),
  /** 点赞类型（实测 `heart`） */
  attitude: z.string().optional(),
  attitude_mask: z.number().optional(),
  attitude_type: z.number().optional(),
  last_attitude: z.string().optional(),
  source: z.string().optional(),
  user: NotificationUserSchema,
  // 被点赞微博可能已被删除，真实样本里存在没有 status 的条目。
  status: MyMBlogItemSchema.optional(),
}).passthrough()

export type AttitudeItem = z.infer<typeof AttitudeItemSchema>

const MessageAttitudesResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    attitudes: z.array(AttitudeItemSchema),
    next_cursor: CursorSchema.optional(),
    previous_cursor: CursorSchema.optional(),
    total_number: z.number().optional(),
    hasvisible: z.boolean().optional(),
    interval: z.number().optional(),
  }).passthrough(),
}).passthrough()

export type MessageAttitudesResponse = z.infer<typeof MessageAttitudesResponseSchema>

export const messageCommentsSpec: EndpointSpec<'MESSAGE_COMMENTS', typeof MessageArgsSchema> = defineEndpoint({
  resourceType: 'MESSAGE_COMMENTS',
  endpoint: 'ajax/message/cmt',
  argsSchema: MessageArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/message/cmt',
    headers: { referer: 'https://weibo.com/' },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: MessageCommentsResponseSchema,
})

export const messageAttitudesSpec: EndpointSpec<'MESSAGE_ATTITUDES', typeof MessageArgsSchema> = defineEndpoint({
  resourceType: 'MESSAGE_ATTITUDES',
  endpoint: 'ajax/message/attitudes',
  argsSchema: MessageArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/message/attitudes',
    headers: { referer: 'https://weibo.com/' },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: MessageAttitudesResponseSchema,
})
