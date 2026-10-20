import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { midToMblogId } from '~/utils/tweetId'
import { defineEndpoint } from '../internal/EndpointSpec'
import { MOBILE_USER_AGENT } from '../internal/GuestTokenService'

/**
 * 移动站通用容器（G4）：`GET https://m.weibo.cn/api/container/getIndex?containerid=<id>[&page=<n>]`
 *
 * 真实响应形态（已验证）：
 * `{ ok: 1, data: { cardlistInfo?: { total, page, since_id, containerid, v_p }, cards: Card[] } }`
 *
 * 卡片形态：
 * - `card_type: 9` —— 卡片自带 `mblog`（完整微博对象，**没有 `mblogid`**，只有数字 `mid` / `id`）；
 * - `card_type: 10 / 11` —— 容器卡片，子项在 `card_group` 里递归；关注 / 粉丝列表的
 *   用户对象在 `card_group[].user`；
 * - 部分卡片带 `title` / `itemid` / `pics`（`pic_small|pic_middle|pic_big|pic_mw2000|mblog`）。
 *
 * 常用 containerid（命名与直觉相反的地方已按实测标注）：
 * - `107603<uid>` 用户微博、`230869<uid>` 点赞列表、`231567<uid>` 视频瀑布
 * - `107803<uid>_-_photoall` 全部图片、`107803<uid>_-_photolike` 赞过的图片
 * - `231051_-_followers_-_<uid>` **关注列表**、`231051_-_follows_-_<uid>` **粉丝列表**
 * - `100103type=1&q=<kw>` 微博搜索、`100103type=3&q=<kw>` 用户搜索
 *
 * 匿名（访客 token）只保证第一页：第 2 页 / `since_id` 会 302 到登录页，
 * 因此服务层标注 `partial: true`，不要把它当成完整归档来源。
 */

/** 卡片里的图片条目（`pics[]`）。 */
export interface MobileCardPic {
  pic_small?: string
  pic_middle?: string
  pic_big?: string
  pic_mw2000?: string
  /** 图片关联的微博对象（图片卡片同样只有数字 mid） */
  mblog?: Record<string, unknown>
  [key: string]: unknown
}

const MobileCardPicSchema: z.ZodType<MobileCardPic> = z.object({
  pic_small: z.string().optional(),
  pic_middle: z.string().optional(),
  pic_big: z.string().optional(),
  pic_mw2000: z.string().optional(),
  mblog: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

/**
 * `getIndex` 的单张卡片。
 *
 * `card_group` 递归（`card_type: 10 / 11` 容器卡片），`mblog` / `user` 保持
 * 宽松的记录类型：m 站字段远多于网页端，归一化只读取其中一部分。
 */
export interface MobileCard {
  card_type?: number
  itemid?: string | number
  title?: string
  desc?: string
  /** `card_type: 9` 的微博对象 */
  mblog?: Record<string, unknown>
  /** `card_group` 内的用户对象（关注 / 粉丝列表） */
  user?: Record<string, unknown>
  /** 子卡片（`card_type: 10 / 11`） */
  card_group?: MobileCard[]
  /** 图片卡片 */
  pics?: MobileCardPic[]
  [key: string]: unknown
}

const MobileCardSchema: z.ZodType<MobileCard> = z.lazy(() => z.object({
  card_type: z.number().optional(),
  itemid: z.union([z.string(), z.number()]).optional(),
  title: z.string().optional(),
  desc: z.string().optional(),
  mblog: z.record(z.string(), z.unknown()).optional(),
  user: z.record(z.string(), z.unknown()).optional(),
  card_group: z.array(MobileCardSchema).optional(),
  pics: z.array(MobileCardPicSchema).optional(),
}).passthrough())

export const MobileCardListInfoSchema = z.object({
  total: z.number().optional(),
  page: z.union([z.number(), z.string(), z.null()]).optional(),
  since_id: z.union([z.string(), z.number()]).optional(),
  containerid: z.string().optional(),
  // 真实样本：timeline 的 v_p 为 number(42)，search / videos 为 string("42")
  v_p: z.union([z.string(), z.number()]).optional(),
}).passthrough()

const MobileContainerResponseSchema = z.object({
  ok: z.number(),
  msg: z.string().optional(),
  data: z.object({
    cardlistInfo: MobileCardListInfoSchema.optional(),
    cards: z.array(MobileCardSchema),
  }).passthrough(),
}).passthrough()

export type MobileContainerResponse = z.infer<typeof MobileContainerResponseSchema>

export const MobileContainerArgsSchema = z.object({
  /** 容器 id，如 `1076032365795232`、`231051_-_followers_-_2365795232` */
  containerid: z.string(),
  /** 页码（1 基）；匿名只有第一页可用，缺省即第一页 */
  page: z.number().optional(),
}).strict()

export type MobileContainerArgs = z.infer<typeof MobileContainerArgsSchema>

export const mobileContainerSpec: EndpointSpec<'MOBILE_CONTAINER', typeof MobileContainerArgsSchema> = defineEndpoint({
  resourceType: 'MOBILE_CONTAINER',
  endpoint: 'api/container/getIndex',
  argsSchema: MobileContainerArgsSchema,
  buildResource: ({ containerid, page }) => ({
    method: 'GET',
    url: `https://m.weibo.cn/api/container/getIndex?containerid=${encodeURIComponent(containerid)}${page === undefined ? '' : `&page=${page}`}`,
    headers: {
      'referer': 'https://m.weibo.cn/',
      'user-agent': MOBILE_USER_AGENT,
    },
  }),
  // m 站容器走访客 token；Cookie 模式下仍优先使用 Cookie
  auth: 'guest',
  okPolicy: { mode: 'require_ok_1' },
  schema: MobileContainerResponseSchema,
})

/** 深度优先展开 `cards`，把 `card_group` 里的子卡片一起摊平。 */
function flattenCards(cards: readonly MobileCard[]): MobileCard[] {
  const flattened: MobileCard[] = []
  const visit = (list: readonly MobileCard[]): void => {
    for (const card of list) {
      flattened.push(card)
      if (Array.isArray(card.card_group))
        visit(card.card_group)
    }
  }
  visit(cards)
  return flattened
}

/** 读取字符串 / 数字形态的 id；空白串与非法数字视为缺失。 */
function readId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  return undefined
}

/**
 * 提取容器里的微博对象。
 *
 * m 站微博没有 `mblogid`，这里按 `mblog.mblogid ?? midToMblogId(mblog.mid ?? mblog.id)`
 * 补齐；补齐不出合法 id 的条目（广告位 / 占位卡片 / id 漂移）直接跳过。
 */
export function extractMobileMblogs(raw: MobileContainerResponse): Record<string, unknown>[] {
  const mblogs: Record<string, unknown>[] = []
  for (const card of flattenCards(raw.data.cards)) {
    const mblog = card.mblog
    if (!mblog)
      continue

    const existing = readId(mblog.mblogid)
    const id = existing ?? readId(mblog.mid) ?? readId(mblog.id)
    if (id === undefined)
      continue

    const mblogid = existing ?? midToMblogId(id)
    if (mblogid === '')
      continue

    mblogs.push(existing === undefined ? { ...mblog, mblogid } : mblog)
  }
  return mblogs
}

/**
 * 提取容器里的用户对象（关注 / 粉丝列表的 `card_group[].user`）。
 *
 * 按 `idstr` / `id` 去重；缺 id 的条目无法判重，原样保留。
 */
export function extractMobileUsers(raw: MobileContainerResponse): Record<string, unknown>[] {
  const users: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const card of flattenCards(raw.data.cards)) {
    const user = card.user
    if (!user)
      continue

    const key = readId(user.idstr) ?? readId(user.id)
    if (key !== undefined) {
      if (seen.has(key))
        continue
      seen.add(key)
    }
    users.push(user)
  }
  return users
}
