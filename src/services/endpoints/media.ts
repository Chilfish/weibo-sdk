import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'
import { MyMBlogItemSchema } from './tweet'

/**
 * 用户图片墙（D4）：`GET /ajax/profile/getImageWall?uid=<uid>&sinceid=<cursor>`
 *
 * 真实响应（`tests/fixtures/raw/image_wall_p1.json`）：
 * - `data.list` 是**媒体资产**，不是微博：`{ pid, mid, is_paid, timeline_year, timeline_month, object_id, type, video? }`
 * - `type` 实测为 `pic` / `livephoto`（视频、GIF 需后续样本确认）
 * - `data.since_id` 是复合游标字符串（如 `"505..._474...|1034:..._20240716_-1"`）；
 *   首屏传 `sinceid=0`，下一页传上一页的 `since_id`。`sinceid=-1` 等同第一页。
 * - 越界/到底的形态尚未抓到空页样本，服务端按「空列表 / 游标不前进」停止。
 */
const ImageWallArgsSchema = z.object({
  uid: z.string(),
  sinceid: z.union([z.string(), z.number()]).optional(),
}).strict()

const ImageWallItemSchema = z.object({
  // 真实样本存在缺 pid 的破损条目（type=pic、object_id=null），保留但由归一化层过滤
  pid: z.string().optional(),
  mid: z.union([z.string(), z.number()]).optional(),
  is_paid: z.boolean().optional(),
  timeline_month: z.union([z.string(), z.number()]).optional(),
  timeline_year: z.union([z.string(), z.number()]).optional(),
  object_id: z.union([z.string(), z.null()]).optional(),
  type: z.string().optional(),
  // livephoto 的 .mov 地址；普通图片缺省
  video: z.string().optional(),
}).passthrough()

const ImageWallResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    since_id: z.union([z.string(), z.number()]).optional(),
    list: z.array(ImageWallItemSchema),
  }).passthrough(),
  bottom_tips_visible: z.boolean().optional(),
  bottom_tips_text: z.string().optional(),
}).passthrough()

export type ImageWallResponse = z.infer<typeof ImageWallResponseSchema>

export const imageWallSpec: EndpointSpec<'PROFILE_IMAGE_WALL', typeof ImageWallArgsSchema> = defineEndpoint({
  resourceType: 'PROFILE_IMAGE_WALL',
  endpoint: 'ajax/profile/getImageWall',
  argsSchema: ImageWallArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/profile/getImageWall',
    headers: { referer: `https://weibo.com/u/${uid}` },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: ImageWallResponseSchema,
})

/**
 * 用户视频瀑布（D5）：`GET /ajax/profile/getWaterFallContent?uid=<uid>&cursor=<cursor>`
 *
 * 真实响应（`tests/fixtures/raw/waterfall_p1.json`）：
 * - `data.list` 是**微博条目**（与 mymblog 同构），视频信息在 `page_info.media_info`；
 * - `data.next_cursor` 是游标字符串，首屏传 `cursor=0`，下一页传上一页的 `next_cursor`；
 * - `cursor=-1` 实测返回 HTTP 400（不要发送负游标）。
 */
const WaterfallArgsSchema = z.object({
  uid: z.string(),
  cursor: z.union([z.string(), z.number()]).optional(),
}).strict()

const WaterfallResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    list: z.array(MyMBlogItemSchema),
    next_cursor: z.union([z.string(), z.number()]).optional(),
  }).passthrough(),
}).passthrough()

export type WaterfallResponse = z.infer<typeof WaterfallResponseSchema>

export const waterfallSpec: EndpointSpec<'PROFILE_WATERFALL', typeof WaterfallArgsSchema> = defineEndpoint({
  resourceType: 'PROFILE_WATERFALL',
  endpoint: 'ajax/profile/getWaterFallContent',
  argsSchema: WaterfallArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/profile/getWaterFallContent',
    headers: { referer: `https://weibo.com/u/${uid}` },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: WaterfallResponseSchema,
})
