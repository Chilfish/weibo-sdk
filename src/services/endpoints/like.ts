import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'
import { PicInfoSchema } from './tweet'

const IdSchema = z.union([z.string(), z.number()])

const LikeUserSchema = z.object({
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  screen_name: z.string().optional(),
  avatar_hd: z.string().optional(),
  avatar_large: z.string().optional(),
  profile_image_url: z.string().optional(),
  verified: z.boolean().optional(),
  verified_type: z.number().optional(),
}).passthrough().nullable().optional()

// 真实 fixture：likes_p1.json / likes_p2.json / likes_end.json
// 注意：第一页的部分条目没有 user / 计数字段，因此除 mblogid 外全部 optional。
const LikeItemSchema: z.ZodType<any> = z.object({
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
  }).passthrough().optional(),
  user: LikeUserSchema,
  attitudes_count: z.number().optional(),
  comments_count: z.number().optional(),
  reposts_count: z.number().optional(),
  pic_ids: z.array(z.string()).optional(),
  pic_infos: z.record(z.string(), PicInfoSchema).optional(),
  annotations: z.array(z.unknown()).optional(),
  page_info: z.record(z.string(), z.unknown()).optional(),
  retweeted_status: z.lazy((): z.ZodType<any> => LikeItemSchema).nullable().optional(),
}).passthrough()

export type LikeItem = z.infer<typeof LikeItemSchema>

const LikeListArgsSchema = z.object({
  uid: z.string(),
  page: z.number().optional(),
  // 上游接受但忽略；保留仅为兼容旧调用方，不参与分页或总数计算。
  with_total: z.boolean().optional(),
}).strict()

export type LikeListArgs = z.infer<typeof LikeListArgsSchema>

// GET /ajax/statuses/likelist?uid=&page=
// 真实响应只有 data.list；无 total / cursor / hasMore。越界页返回 200 + 空数组。
const LikeListResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    list: z.array(LikeItemSchema),
  }).passthrough(),
}).passthrough()

export type LikeListResponse = z.infer<typeof LikeListResponseSchema>

export const likeListSpec: EndpointSpec<'LIKES_LIST', typeof LikeListArgsSchema> = defineEndpoint({
  resourceType: 'LIKES_LIST',
  endpoint: 'ajax/statuses/likelist',
  argsSchema: LikeListArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/likelist',
    headers: { referer: `https://weibo.com/u/${uid}` },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: LikeListResponseSchema,
})
