import { z } from 'zod'

// 微博 API 返回的用户基础信息
export const RawWeiboUserSchema = z.object({
  id: z.number().or(z.string()), // 微博 API 这里的类型经常变
  idstr: z.string(),
  screen_name: z.string(),
  avatar_hd: z.string().optional(),
  avatar_large: z.string().optional(),
  profile_url: z.string().optional(),
  description: z.string().default(''),

  // 认证相关
  verified: z.boolean().default(false),
  verified_type: z.number().default(-1),
  verified_reason: z.string().optional(),

  // 统计数据
  followers_count: z.number().default(0),
  friends_count: z.number().default(0), // 关注数
  statuses_count: z.number().default(0),

  // 元数据
  mbrank: z.number().optional(),
  mbtype: z.number().optional(),
})

// 微博 API 返回的详情信息 (/profile/detail)
export const RawWeiboDetailSchema = z.object({
  created_at: z.string().optional(), // 注册时间
  birthday: z.string().optional(),
  sunshine_credit: z.object({
    level: z.string().optional(),
  }).optional(),
})

export type RawWeiboUser = z.infer<typeof RawWeiboUserSchema>
export type RawWeiboDetail = z.infer<typeof RawWeiboDetailSchema>
