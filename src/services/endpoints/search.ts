import type { ZodType } from 'zod'
import type { EndpointSpec } from '../internal/EndpointSpec'
import type { ISearchTweetsResponse, ISearchUsersResponse } from '~/types/raw/search/search'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

const SearchArgsSchema = z.object({
  q: z.string(),
  page: z.number().optional(),
}).strict()

const SearchUsersResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    users: z.array(z.unknown()).optional(),
    total: z.number().optional(),
    page: z.number().optional(),
  }).loose(),
}).loose() as unknown as ZodType<ISearchUsersResponse>

const SearchTweetsResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    tweets: z.array(z.unknown()).optional(),
    total: z.number().optional(),
    page: z.number().optional(),
  }).loose(),
}).loose() as unknown as ZodType<ISearchTweetsResponse>

export const searchUsersSpec: EndpointSpec<'SEARCH_USERS', typeof SearchArgsSchema> = defineEndpoint({
  resourceType: 'SEARCH_USERS',
  endpoint: 'ajax/search/users',
  argsSchema: SearchArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/search/users',
    headers: {
      referer: 'https://weibo.com/',
    },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: SearchUsersResponseSchema,
})

export const searchTweetsSpec: EndpointSpec<'SEARCH_TWEETS', typeof SearchArgsSchema> = defineEndpoint({
  resourceType: 'SEARCH_TWEETS',
  endpoint: 'ajax/search/tweets',
  argsSchema: SearchArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/search/tweets',
    headers: {
      referer: 'https://weibo.com/',
    },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: SearchTweetsResponseSchema,
})
