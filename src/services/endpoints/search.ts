import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

/**
 * 搜索 API 使用 m.weibo.cn（移动端 API），而非 weibo.com。
 *
 * containerid 编码格式：`100103type={type}&q={query}&t=`
 * - type=3 → 用户搜索
 * - type=1 → 微博搜索
 *
 * 鉴权：两个 spec 保持默认 `auth: 'cookie'`。G5（guest 搜索）经产品决定**暂缓**：
 * 访客身份下 m 站搜索不稳定，需产品确认后再改为 `guest`，避免静默降级。
 */

const SearchArgsSchema = z.object({
  q: z.string(),
  page: z.number().optional(),
}).strict()

function buildContainerId(type: 1 | 3, query: string): string {
  return `100103type=${type}&q=${encodeURIComponent(query)}&t=`
}

const SearchUserCardSchema = z.object({
  id: z.number(),
  idstr: z.string().optional(),
  screen_name: z.string(),
  profile_image_url: z.string().optional(),
  avatar_hd: z.string().optional(),
  avatar_large: z.string().optional(),
  verified: z.boolean().optional(),
  verified_type: z.number().optional(),
  followers_count: z.union([z.number(), z.string()]).optional(),
  description: z.string().optional(),
  gender: z.string().optional(),
}).loose()

const SearchUsersResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    cards: z.array(z.object({
      card_type: z.number().optional(),
      card_group: z.array(z.object({
        user: SearchUserCardSchema.optional(),
      }).loose()).optional(),
    }).loose()),
    cardlistInfo: z.object({
      page: z.number().nullable().optional(),
      total: z.number().optional(),
      containerid: z.string().optional(),
    }).loose().optional(),
  }).loose(),
}).loose()

export type SearchUsersResponse = z.infer<typeof SearchUsersResponseSchema>

const SearchTweetsResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    cards: z.array(z.object({
      card_type: z.number().optional(),
      mblog: z.record(z.string(), z.unknown()).optional(),
      card_group: z.array(z.unknown()).optional(),
    }).loose()),
    cardlistInfo: z.object({
      page: z.number().nullable().optional(),
      total: z.number().optional(),
    }).loose().optional(),
  }).loose(),
}).loose()

export type SearchTweetsResponse = z.infer<typeof SearchTweetsResponseSchema>

export const searchUsersSpec: EndpointSpec<'SEARCH_USERS', typeof SearchArgsSchema> = defineEndpoint({
  resourceType: 'SEARCH_USERS',
  endpoint: 'api/container/getIndex',
  argsSchema: SearchArgsSchema,
  buildResource: ({ q, page }) => ({
    method: 'GET',
    url: `https://m.weibo.cn/api/container/getIndex?containerid=${encodeURIComponent(buildContainerId(3, q))}&page_type=searchall${page ? `&page=${page}` : ''}`,
    headers: {
      referer: `https://m.weibo.cn/search?containerid=${encodeURIComponent(buildContainerId(1, q))}`,
    },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: SearchUsersResponseSchema,
})

export const searchTweetsSpec: EndpointSpec<'SEARCH_TWEETS', typeof SearchArgsSchema> = defineEndpoint({
  resourceType: 'SEARCH_TWEETS',
  endpoint: 'api/container/getIndex',
  argsSchema: SearchArgsSchema,
  buildResource: ({ q, page }) => ({
    method: 'GET',
    url: `https://m.weibo.cn/api/container/getIndex?containerid=${encodeURIComponent(buildContainerId(1, q))}&page_type=searchall${page ? `&page=${page}` : ''}`,
    headers: {
      referer: `https://m.weibo.cn/search?containerid=${encodeURIComponent(buildContainerId(1, q))}`,
    },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: SearchTweetsResponseSchema,
})
