import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

const IdSchema = z.union([z.string(), z.number()])

export const FollowingUserSchema: z.ZodType<any> = z.object({
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  screen_name: z.string().optional(),
  name: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  profile_image_url: z.string().optional(),
  avatar_hd: z.string().optional(),
  avatar_large: z.string().optional(),
  follow_me: z.boolean().optional(),
  following: z.boolean().optional(),
  followers_count: z.number().optional(),
  friends_count: z.number().optional(),
  statuses_count: z.number().optional(),
  verified: z.boolean().optional(),
  verified_type: z.number().optional(),
  verified_reason: z.string().optional(),
  gender: z.string().optional(),
}).passthrough()

const FriendshipsArgsSchema = z.object({
  uid: z.string(),
  page: z.number().optional(),
  // relate=fans 查粉丝，缺省/relate=following 查关注（真实 fixture：friendships_fans_*.json）
  relate: z.enum(['fans', 'following']).optional(),
}).strict()

const FriendshipsResponseSchema = z.object({
  users: z.array(FollowingUserSchema),
  next_cursor: z.number().optional(),
  previous_cursor: z.number().optional(),
  total_number: z.number().optional(),
  ok: z.number(),
}).passthrough()

export type FriendshipsResponse = z.infer<typeof FriendshipsResponseSchema>

export const friendshipsSpec: EndpointSpec<'FRIENDSHIPS_FRIENDS', typeof FriendshipsArgsSchema> = defineEndpoint({
  resourceType: 'FRIENDSHIPS_FRIENDS',
  endpoint: 'ajax/friendships/friends',
  argsSchema: FriendshipsArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/friendships/friends',
    headers: {
      referer: `https://weibo.com/u/${uid}`,
    },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: FriendshipsResponseSchema,
})

const FollowContentArgsSchema = z.object({
  page: z.number().optional(),
}).strict()

const FollowContentFollowsSchema = z.object({
  users: z.array(FollowingUserSchema),
  next_cursor: z.number().optional(),
  previous_cursor: z.number().optional(),
  total_number: z.number().optional(),
}).passthrough()

const FollowContentDataSchema = z.object({
  follows: FollowContentFollowsSchema,
  specialAttention: z.array(z.unknown()).optional(),
  total_number: z.number().optional(),
}).passthrough()

const FollowContentResponseSchema = z.object({
  ok: z.number(),
  data: FollowContentDataSchema,
}).passthrough()

export type FollowContentResponse = z.infer<typeof FollowContentResponseSchema>

export const followContentSpec: EndpointSpec<'PROFILE_FOLLOWCONTENT', typeof FollowContentArgsSchema> = defineEndpoint({
  resourceType: 'PROFILE_FOLLOWCONTENT',
  endpoint: 'ajax/profile/followContent',
  argsSchema: FollowContentArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/profile/followContent',
    headers: {
      referer: 'https://weibo.com/',
    },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: FollowContentResponseSchema,
})
