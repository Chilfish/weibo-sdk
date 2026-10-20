import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'
import { PicInfoSchema } from './tweet'

const FavoritesArgsSchema = z.object({
  uid: z.string(),
  page: z.number().optional(),
  // 实测：必须带 with_total=true，否则 data 返回裸数组而非 { status: [...] }
  with_total: z.boolean().optional(),
}).strict()

const FavoriteItemSchema: z.ZodType<any> = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  idstr: z.string().optional(),
  mblogid: z.string(),
  mid: z.string().optional(),
  created_at: z.string().optional(),
  text: z.string().optional(),
  text_raw: z.string().optional(),
  source: z.string().optional(),
  visible: z.object({
    type: z.number(),
    list_id: z.number().optional(),
  }).passthrough().optional(),
  user: z.object({
    id: z.union([z.string(), z.number()]).optional(),
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
  // 收藏项自带的标签；现有 fixture 均为空数组，元素结构未抓包，只约束为数组
  tags: z.array(z.unknown()).optional(),
  annotations: z.array(z.unknown()).optional(),
  page_info: z.record(z.string(), z.unknown()).optional(),
  retweeted_status: z.lazy((): z.ZodType<any> => FavoriteItemSchema).nullable().optional(),
}).passthrough()

const FavoritesResponseSchema = z.object({
  ok: z.number(),
  // 真实响应（2026-10-20 线上复核）：顶层 count / total_page 用于翻页判定；
  // 部分 fixture 不含这两个字段，保持 optional。
  count: z.number().optional(),
  total_page: z.number().optional(),
  // 真实 API：data 为对象，微博列表在 data.status（见 fixtures/raw/favorites_p1.json）
  data: z.object({
    status: z.array(FavoriteItemSchema),
    total_number: z.number().optional(),
  }).passthrough(),
}).passthrough()

export type FavoritesResponse = z.infer<typeof FavoritesResponseSchema>

export const favoritesSpec: EndpointSpec<'FAVORITES_ALLFAV', typeof FavoritesArgsSchema> = defineEndpoint({
  resourceType: 'FAVORITES_ALLFAV',
  endpoint: 'ajax/favorites/all_fav',
  argsSchema: FavoritesArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/favorites/all_fav',
    headers: { referer: `https://weibo.com/u/${uid}` },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: FavoritesResponseSchema,
})

// ---- Favorites Tags (收藏夹标签) ----

// 真实 fixture：favorites_tags.json（tags 为空数组）。标签元素结构未知（无样本），
// 只约束为数组，不猜元素结构；顶层数字字段 optional（空标签与含计数变种形态不同）
const FavoritesTagsArgsSchema = z.object({}).strict()

const FavoritesTagsResponseSchema = z.object({
  ok: z.number(),
  tags: z.array(z.unknown()),
  total_number: z.number().optional(),
  unclassified_num: z.number().optional(),
  fav_total_num: z.number().optional(),
}).passthrough()

export type FavoritesTagsResponse = z.infer<typeof FavoritesTagsResponseSchema>

export const favoritesTagsSpec: EndpointSpec<'FAVORITES_TAGS', typeof FavoritesTagsArgsSchema> = defineEndpoint({
  resourceType: 'FAVORITES_TAGS',
  endpoint: 'ajax/favorites/tags',
  argsSchema: FavoritesTagsArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/favorites/tags',
    headers: { referer: 'https://weibo.com/fav' },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: FavoritesTagsResponseSchema,
})
