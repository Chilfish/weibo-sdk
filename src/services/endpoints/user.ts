import type { ZodType } from 'zod'
import type { EndpointSpec } from '../internal/EndpointSpec'
import type { IUserDetailsResponse } from '~/types/raw/user/Details'
import type { IUserInfoResponse } from '~/types/raw/user/Info'
import { z } from 'zod'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { defineEndpoint } from '../internal/EndpointSpec'

const UserInfoArgsSchema = z.object({
  uid: z.string(),
}).strict()

const UserDetailsArgsSchema = z.object({
  uid: z.string(),
}).strict()

const UserInfoResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    user: z.object({}).loose(),
  }).loose(),
}).loose() as unknown as ZodType<IUserInfoResponse>

const UserDetailsResponseSchema = z.object({
  ok: z.number(),
  data: z.object({}).loose(),
}).loose() as unknown as ZodType<IUserDetailsResponse>

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
  okPolicy: { mode: 'require_ok_1' },
  schema: UserDetailsResponseSchema,
})

export const myDetailsSpec: EndpointSpec<'USER_DETAILS', undefined> = defineEndpoint({
  resourceType: 'USER_DETAILS',
  endpoint: 'ajax/profile/detail',
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/profile/detail',
    headers: {
      referer: 'https://weibo.com/',
    },
  }),
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

