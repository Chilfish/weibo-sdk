import { defineCommand } from 'citty'
import { WeiboSDK } from '../../WeiboSDK'
import type { IWeiboConfig } from '../../types/config'

function createSDK(cookie?: string): WeiboSDK {
  const c = cookie || process.env.WEIBO_COOKIE || ''
  const config: IWeiboConfig = { cookie: c, selfCheck: { mode: 'lazy' } }
  return new WeiboSDK(config)
}

export const userInfo = defineCommand({
  meta: {
    name: 'info',
    description: '获取用户信息',
  },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    cookie: { type: 'string', description: '微博 Cookie（或设 WEIBO_COOKIE 环境变量）' },
  },
  async run({ args }) {
    const sdk = createSDK(args.cookie as string)
    const user = await sdk.users.getById(args.id)
    console.log(JSON.stringify(user, null, 2))
  },
})

export const userTimeline = defineCommand({
  meta: {
    name: 'timeline',
    description: '获取用户微博时间线',
  },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    since_id: { type: 'string', description: '分页游标' },
    count: { type: 'string', description: '每页条数' },
    cookie: { type: 'string', description: '微博 Cookie' },
  },
  async run({ args }) {
    const sdk = createSDK(args.cookie as string)
    const page = await sdk.tweets.listByUserId(args.id, {
      sinceId: args.since_id ? Number(args.since_id) : undefined,
      count: args.count ? Number(args.count) : undefined,
    })
    console.log(JSON.stringify(page, null, 2))
  },
})
