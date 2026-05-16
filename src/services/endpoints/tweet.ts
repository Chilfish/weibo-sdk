import type { ZodType } from 'zod'
import type { EndpointSpec } from '../internal/EndpointSpec'
import type { IMyMBlogResponse } from '~/types/raw/tweet/mymblog'
import type { IStatusShowResponse } from '~/types/raw/tweet/show'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

const MyMblogArgsSchema = z.object({
  uid: z.string(),
  since_id: z.number().optional(),
}).strict()

const StatusShowArgsSchema = z.object({
  id: z.string(),
  isGetLongText: z.boolean(),
}).strict()

const MyMblogResponseSchema = z.object({
  since_id: z.number().optional(),
  list: z.array(z.unknown()).optional(),
  total: z.number().optional(),
}).loose() as unknown as ZodType<IMyMBlogResponse>

const IdSchema = z.union([z.string(), z.number()])

const StatusShowResponseSchema = z.object({
  ok: z.number(),
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  mblogid: z.string(),
  created_at: z.string(),
  user: z.object({
    id: IdSchema.optional(),
    idstr: z.string().optional(),
  }).loose(),
}).loose().superRefine((val, ctx) => {
  if (val.id === undefined && !val.idstr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tweet.id or tweet.idstr is required',
      path: ['id'],
    })
  }
  if (val.user.id === undefined && !val.user.idstr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tweet.user.id or tweet.user.idstr is required',
      path: ['user', 'id'],
    })
  }
}) as unknown as ZodType<IStatusShowResponse>

export const myMblogSpec: EndpointSpec<'TWEET_MYMBLOG', typeof MyMblogArgsSchema> = defineEndpoint({
  resourceType: 'TWEET_MYMBLOG',
  endpoint: 'ajax/statuses/mymblog',
  argsSchema: MyMblogArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/mymblog',
    headers: {
      referer: `https://weibo.com/u/${uid}`,
    },
  }),
  okPolicy: { mode: 'none' },
  schema: MyMblogResponseSchema,
})

export const statusShowSpec: EndpointSpec<'TWEET_SHOW', typeof StatusShowArgsSchema> = defineEndpoint({
  resourceType: 'TWEET_SHOW',
  endpoint: 'ajax/statuses/show',
  argsSchema: StatusShowArgsSchema,
  buildResource: ({ id }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/show',
    headers: {
      referer: `https://weibo.com/detail/${id}`,
    },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: StatusShowResponseSchema,
})

