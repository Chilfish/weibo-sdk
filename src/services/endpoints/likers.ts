import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

const IdSchema = z.union([z.string(), z.number()])

/**
 * 点赞者条目里的用户。
 *
 * 真实样本来自 `m.weibo.cn/api/attitudes/show`（见 `likers_p1.json`）：
 * 用户字段与网页端基本同构，但部分计数以字符串下发（`followers_count: "300"`），
 * 这里只声明归一化实际读取的字段，其余 passthrough。
 */
const LikerUserSchema = z.object({
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  screen_name: z.string().optional(),
  name: z.string().optional(),
  profile_image_url: z.string().optional(),
  avatar_hd: z.string().optional(),
  avatar_large: z.string().optional(),
  verified: z.boolean().optional(),
  verified_type: z.number().optional(),
}).loose()

// 真实 fixture：likers_p1.json / likers_p2.json / likers_end.json
const LikerItemSchema = z.object({
  id: IdSchema.optional(),
  created_at: z.string().optional(),
  source: z.string().optional(),
  user: LikerUserSchema,
}).loose()

const LikersArgsSchema = z.object({
  /** 微博 mid（数字 id 字符串，不是字母 mblogid） */
  id: z.union([z.string(), z.number()]),
  page: z.number().optional(),
}).strict()

export type LikersArgs = z.infer<typeof LikersArgsSchema>

/**
 * m 站空结果文案。
 *
 * 2026-10-23 实测：微博还没有人点赞时返回 `{ ok: 0, msg: '还没有人赞过' }`，
 * 且**不带 `data` 字段**。这是正常空页，不应报 `API_NOT_OK`。
 */
const EMPTY_RESULT_MESSAGES = new Set(['还没有人赞过', '暂无数据', '这里还没有内容'])

export function isEmptyLikersPage(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return false
  const record = raw as Record<string, unknown>
  return record.ok === 0
    && typeof record.msg === 'string'
    && EMPTY_RESULT_MESSAGES.has(record.msg)
}

const LikersResponseSchema = z.object({
  ok: z.number(),
  msg: z.string().optional(),
  /** 空结果响应不带 `data`；正常页 / 越界页才有。 */
  data: z.object({
    /** 当前请求页码（上游回显；仅用于诊断） */
    max: z.union([z.number(), z.string()]).optional(),
    total_number: z.number().optional(),
    /** 越界页为 null；正常页为数组 */
    data: z.array(LikerItemSchema).nullable().optional(),
  }).loose().optional(),
}).loose()

export type LikersResponse = z.infer<typeof LikersResponseSchema>

/**
 * 微博点赞者列表（D8）。
 *
 * **端点漂移（2026-10-20 实测）**：网页端 `weibo.com/ajax/statuses/likeShow?id=<mid>&page=<n>`
 * 仍识别微博并返回正确的 `total_number`，但 `data` 恒为 `[]`（疑似隐私/风控门控）；
 * `m.weibo.cn/api/attitudes/show?id=<mid>&page=<n>` 可正常返回点赞用户。
 * 因此 SDK 采用 m 站端点，字段结构与网页端一致（`data.data[]` / `total_number`）。
 *
 * 分页为 page 型（1 基）；越界页返回 `data: null`（仍 `ok: 1`），服务层按空页处理。
 */
export const likersSpec: EndpointSpec<'TWEET_LIKERS', typeof LikersArgsSchema> = defineEndpoint({
  resourceType: 'TWEET_LIKERS',
  endpoint: 'api/attitudes/show',
  argsSchema: LikersArgsSchema,
  buildResource: ({ id }) => ({
    method: 'GET',
    url: 'https://m.weibo.cn/api/attitudes/show',
    headers: { referer: `https://m.weibo.cn/status/${id}` },
  }),
  // m 站点赞者公开可读：访客 token 可用（研究实测含翻页）
  auth: 'guest',
  okPolicy: {
    mode: 'require_ok_1',
    isEmptyResult: ({ raw }) => isEmptyLikersPage(raw),
  },
  schema: LikersResponseSchema,
})
