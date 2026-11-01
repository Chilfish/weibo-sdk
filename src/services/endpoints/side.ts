import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

const BandUnifiedArgsSchema = z.object({
  type: z.string(),
}).strict()

const BandItemSchema = z.object({
  word: z.string(),
  num: z.number().optional(),
  category: z.string().optional(),
  label_name: z.string().optional(),
  icon_desc: z.string().optional(),
  flag: z.number().optional(),
  word_scheme: z.string().optional(),
  // 真实 fixture（hot_trends.json）里 `realpos` 是 1 基展示位次，`rank` 是 0 基下标；
  // 热榜存在并列与置顶，不能拿数组下标当名次。
  realpos: z.number().optional(),
  rank: z.number().optional(),
}).loose()

const BandUnifiedResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    realtime: z.array(BandItemSchema).optional(),
    hotgovs: z.array(z.unknown()).optional(),
    hotgov: z.record(z.string(), z.unknown()).optional(),
  }).loose(),
}).loose()

export type BandUnifiedResponse = z.infer<typeof BandUnifiedResponseSchema>

export const bandUnifiedSpec: EndpointSpec<'SIDE_BANDUNIFIED', typeof BandUnifiedArgsSchema> = defineEndpoint({
  resourceType: 'SIDE_BANDUNIFIED',
  endpoint: 'ajax/side/bandUnified',
  argsSchema: BandUnifiedArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/side/bandUnified',
    headers: { referer: 'https://weibo.com/' },
  }),
  // 热搜榜公开可读：访客 token 可用
  auth: 'guest',
  okPolicy: { mode: 'require_ok_1' },
  schema: BandUnifiedResponseSchema,
})
