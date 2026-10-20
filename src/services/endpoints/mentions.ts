import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'
import { MyMBlogItemSchema } from './tweet'

const CursorSchema = z.union([z.number(), z.string()])

/**
 * `@我的微博` 分页参数。
 *
 * 实测（2026-10-20）：`page=<n>`（1 基）与 `max_id=<上一页 data.next_cursor>` 等价；
 * `since_id` 被上游忽略（始终返回第一页）。
 */
const MentionsViewArgsSchema = z.object({
  max_id: z.number().optional(),
  page: z.number().optional(),
}).strict()

export type MentionsViewArgs = z.infer<typeof MentionsViewArgsSchema>

/**
 * `GET /ajax/statuses/mentions` 真实响应（`mentions_p1.json` / `mentions_p2.json` / `mentions_end.json`）：
 * `data.statuses` 为微博数组（与 mymblog 同构），游标 `data.next_cursor`；到底时 `next_cursor: 0` + 空数组。
 */
const MentionsViewResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    statuses: z.array(MyMBlogItemSchema),
    previous_cursor: CursorSchema.optional(),
    next_cursor: CursorSchema.optional(),
    total_number: z.number().optional(),
    hasvisible: z.boolean().optional(),
    interval: z.number().optional(),
  }).passthrough(),
}).passthrough()

export type MentionsViewResponse = z.infer<typeof MentionsViewResponseSchema>

export const mentionsSpec: EndpointSpec<'MENTIONS_STATUSES', typeof MentionsViewArgsSchema> = defineEndpoint({
  resourceType: 'MENTIONS_STATUSES',
  endpoint: 'ajax/statuses/mentions',
  argsSchema: MentionsViewArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/mentions',
    headers: { referer: 'https://weibo.com/' },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: MentionsViewResponseSchema,
})
