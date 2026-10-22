import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

/**
 * 超话分类（D7）：`GET /ajax/stopic/cates`
 *
 * 真实响应（`tests/fixtures/raw/stopic_cates.json`）：
 * `{ ok: 1, code: 1, data: [{ id, name }] }`，共 19 个分类；
 * `sort_id` 取这里返回的 `id`（如「最近使用」= 123333）。
 */
const STopicCatesArgsSchema = z.object({}).strict()

const STopicCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
}).loose()

const STopicCatesResponseSchema = z.object({
  ok: z.number(),
  code: z.number().optional(),
  data: z.array(STopicCategorySchema),
}).loose()

export type STopicCatesResponse = z.infer<typeof STopicCatesResponseSchema>

export const stopicCatesSpec: EndpointSpec<'STOPIC_CATES', typeof STopicCatesArgsSchema> = defineEndpoint({
  resourceType: 'STOPIC_CATES',
  endpoint: 'ajax/stopic/cates',
  argsSchema: STopicCatesArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/stopic/cates',
    headers: { referer: 'https://weibo.com/' },
  }),
  // 超话分类公开可读：访客 token 可用
  auth: 'guest',
  okPolicy: { mode: 'require_ok_1' },
  schema: STopicCatesResponseSchema,
})

/**
 * 超话列表 / 搜索（D7）：`GET /ajax/stopic/list?sort_id=&keyword=&page=`
 *
 * 真实响应（`tests/fixtures/raw/stopic_list_p1.json` / `stopic_list_search.json`）：
 * - `data` 是超话数组，`count` 是**总页数**（30 条/页），`page` 从 1 开始；
 * - 分类浏览：`sort_id=<cates id>` + `keyword=`；
 * - 关键词搜索：`sort_id=0` + `keyword=<关键词>`；
 * - 失败时返回 `{ errno, errmsg, errcode }`（无 `ok`），仍按 `ok` 校验兜底为业务错误。
 */
const STopicListArgsSchema = z.object({
  sort_id: z.number().optional(),
  keyword: z.string().optional(),
  page: z.number().optional(),
}).strict()

const STopicItemSchema = z.object({
  page_id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  icon: z.string().optional(),
  is_circle: z.number().optional(),
  ori_rank: z.number().optional(),
}).loose()

const STopicListResponseSchema = z.object({
  ok: z.number(),
  code: z.number().optional(),
  count: z.number().optional(),
  since_id: z.union([z.string(), z.number()]).optional(),
  data: z.array(STopicItemSchema),
}).loose()

export type STopicListResponse = z.infer<typeof STopicListResponseSchema>

export const stopicListSpec: EndpointSpec<'STOPIC_LIST', typeof STopicListArgsSchema> = defineEndpoint({
  resourceType: 'STOPIC_LIST',
  endpoint: 'ajax/stopic/list',
  argsSchema: STopicListArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/stopic/list',
    headers: { referer: 'https://weibo.com/' },
  }),
  // 超话列表 / 搜索公开可读：访客 token 可用
  auth: 'guest',
  okPolicy: { mode: 'require_ok_1' },
  schema: STopicListResponseSchema,
})
