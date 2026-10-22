import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

const IdSchema = z.union([z.string(), z.number()])

const FeedGroupItemSchema = z.object({
  gid: IdSchema.optional(),
  uid: IdSchema.optional(),
  title: z.string().optional(),
  navigation_title: z.string().optional(),
  count: z.number().optional(),
  type: IdSchema.optional(),
  sysgroup: z.number().optional(),
  apipath: z.string().optional(),
  is_unread: z.number().optional(),
}).loose()

const FeedGroupsArgsSchema = z.object({}).strict()

/**
 * `GET /ajax/feed/allGroups`（D11）。
 *
 * 真实 fixture：`feed_groups.json`。顶层 `groups[]` 是分组分类（默认分组 / 我的分组 / 订阅分组 / 我的频道），
 * 每个分类下 `group[]` 才是真正的分组；`type` 可能为 string 或 number。
 */
const FeedGroupsResponseSchema = z.object({
  ok: z.number(),
  groups: z.array(z.object({
    title: z.string().optional(),
    group_type: z.number().optional(),
    group: z.array(FeedGroupItemSchema),
  }).loose()),
  total_number: z.number().optional(),
  fetch_hot: z.union([z.string(), z.number()]).optional(),
  is_new_segment: z.union([z.string(), z.number()]).optional(),
  feed_default: z.number().optional(),
  trans_param: z.string().optional(),
}).loose()

export type FeedGroupsResponse = z.infer<typeof FeedGroupsResponseSchema>

/** `GET /ajax/mblog/querygroup`（D11）：`data.join_groups` 为当前账号加入的微博分组。 */
const MblogGroupsArgsSchema = z.object({
  gid: IdSchema.optional(),
}).strict()

export type MblogGroupsArgs = z.infer<typeof MblogGroupsArgsSchema>

const MblogGroupsResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    total: z.number().optional(),
    join_groups: z.array(z.object({
      page_objectid: z.string().optional(),
      name: z.string().optional(),
      system_name: z.string().optional(),
      id: IdSchema.optional(),
    }).loose()),
    result: z.unknown().optional(),
    ts: z.number().optional(),
  }).loose(),
}).loose()

export type MblogGroupsResponse = z.infer<typeof MblogGroupsResponseSchema>

export const feedGroupsSpec: EndpointSpec<'FEED_GROUPS', typeof FeedGroupsArgsSchema> = defineEndpoint({
  resourceType: 'FEED_GROUPS',
  endpoint: 'ajax/feed/allGroups',
  argsSchema: FeedGroupsArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/feed/allGroups',
    headers: { referer: 'https://weibo.com/' },
  }),
  // 分组定义是公开配置：不注入任何凭证也能读到（D11）
  auth: 'none',
  okPolicy: { mode: 'require_ok_1' },
  schema: FeedGroupsResponseSchema,
})

export const mblogGroupsSpec: EndpointSpec<'MBLOG_GROUPS', typeof MblogGroupsArgsSchema> = defineEndpoint({
  resourceType: 'MBLOG_GROUPS',
  endpoint: 'ajax/mblog/querygroup',
  argsSchema: MblogGroupsArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/mblog/querygroup',
    headers: { referer: 'https://weibo.com/' },
  }),
  // 微博分组是账号数据：guest 下返回访客自己的分组（假成功），必须要求 Cookie
  auth: 'cookie',
  okPolicy: { mode: 'require_ok_1' },
  schema: MblogGroupsResponseSchema,
})
