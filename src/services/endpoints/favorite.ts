import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'
import { PicInfoSchema } from './tweet'

const FavoritesArgsSchema = z.object({
  uid: z.string(),
  page: z.number().optional(),
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
  annotations: z.array(z.unknown()).optional(),
  page_info: z.record(z.string(), z.unknown()).optional(),
  retweeted_status: z.lazy((): z.ZodType<any> => FavoriteItemSchema).nullable().optional(),
}).passthrough()

const FavoritesResponseSchema = z.object({
  ok: z.number(),
  // 真实 API：data 为对象，微博列表在 data.status（见 fixtures/raw/favorites_p1.json）
  data: z.object({
    status: z.array(FavoriteItemSchema),
    total_number: z.number().optional(),
  }).passthrough(),
})

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
