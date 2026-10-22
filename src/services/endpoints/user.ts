import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { defineEndpoint } from '../internal/EndpointSpec'

const UserInfoArgsSchema = z.object({
  uid: z.string(),
  scene: z.string().optional(),
}).strict()

const UserDetailsArgsSchema = z.object({
  uid: z.string(),
}).strict()

const LabelModeSchema = z.object({
  word_color: z.string().optional(),
  background_color: z.string().optional(),
}).passthrough()

const LabelDescSchema = z.object({
  name: z.string().optional(),
  normal_mode: LabelModeSchema.optional(),
  dark_mode: LabelModeSchema.optional(),
  scheme_url: z.string().optional(),
}).passthrough()

const UserInfoResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    user: z.object({
      id: z.number().optional(),
      idstr: z.string().optional(),
      screen_name: z.string().optional(),
      avatar_hd: z.string().optional(),
      avatar_large: z.string().optional(),
      profile_image_url: z.string().optional(),
      cover_image_phone: z.string().optional(),
      profile_url: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      gender: z.string().optional(),
      verified: z.boolean().optional(),
      verified_type: z.number().optional(),
      verified_reason: z.string().optional(),
      followers_count: z.number().optional(),
      friends_count: z.number().optional(),
      statuses_count: z.number().optional(),
      svip: z.number().optional(),
      mbrank: z.number().optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough()

const UserDetailsResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    created_at: z.string().optional(),
    desc_text: z.string().optional(),
    ip_location: z.string().optional(),
    gender: z.string().optional(),
    birthday: z.string().optional(),
    description: z.string().optional(),
    education: z.object({ school: z.string().optional() }).passthrough().optional(),
    sunshine_credit: z.object({ level: z.string().optional() }).passthrough().optional(),
    followers: z.object({ total_number: z.number().optional() }).passthrough().optional(),
    label_desc: z.array(LabelDescSchema).optional(),
    verified_url: z.string().optional(),
    friend_info: z.string().optional(),
    links: z.array(z.object({
      title: z.string().optional(),
      url: z.string().optional(),
    }).passthrough()).optional(),
    real_name: z.object({
      name: z.string().optional(),
      career: z.string().optional(),
    }).passthrough().optional(),
    company: z.string().optional(),
    career: z.object({ company: z.string().optional() }).passthrough().optional(),
    hometown: z.string().optional(),
  }).passthrough(),
}).passthrough()

export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>
export type UserDetailsResponse = z.infer<typeof UserDetailsResponseSchema>

export const userInfoSpec: EndpointSpec<'USER_INFO', typeof UserInfoArgsSchema> = defineEndpoint({
  resourceType: 'USER_INFO',
  endpoint: 'ajax/profile/info',
  argsSchema: UserInfoArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/profile/info',
    headers: {
      referer: `https://weibo.com/u/${uid}`,
    },
  }),
  // 公开资料：访客 token 可读（G2）
  auth: 'guest',
  okPolicy: { mode: 'require_ok_1' },
  schema: UserInfoResponseSchema,
})

export const userDetailsSpec: EndpointSpec<'USER_DETAILS', typeof UserDetailsArgsSchema> = defineEndpoint({
  resourceType: 'USER_DETAILS',
  endpoint: 'ajax/profile/detail',
  argsSchema: UserDetailsArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/profile/detail',
    headers: {
      referer: `https://weibo.com/u/${uid}`,
    },
  }),
  // 公开的资料详情（ip 属地 / 教育 / 公司等）：访客 token 可读（G2）
  auth: 'guest',
  okPolicy: { mode: 'require_ok_1' },
  schema: UserDetailsResponseSchema,
})

const MyDetailsArgsSchema = z.object({}).strict()

export const myDetailsSpec: EndpointSpec<'USER_DETAILS', typeof MyDetailsArgsSchema> = defineEndpoint({
  argsSchema: MyDetailsArgsSchema,
  resourceType: 'USER_DETAILS',
  endpoint: 'ajax/profile/detail',
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/profile/detail',
    headers: {
      referer: 'https://weibo.com/',
    },
  }),
  // 账号自身资料：访客 token 只会返回访客自己的数据，必须要求登录 Cookie
  auth: 'cookie',
  okPolicy: {
    mode: 'require_ok_1',
    notOkError: ({ endpoint, ok, message, raw }) => new WeiboSessionExpiredError('Weibo session expired or cookie is invalid.', {
      endpoint,
      ok,
      message,
      raw,
    }),
  },
  schema: UserDetailsResponseSchema,
})
