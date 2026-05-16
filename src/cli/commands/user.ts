import { defineCommand } from 'citty'
import { WeiboSDK } from '../../WeiboSDK'

function sdk(): WeiboSDK {
  return new WeiboSDK({ cookie: process.env.WEIBO_COOKIE || '', selfCheck: { mode: 'lazy' } })
}

export const userInfo = defineCommand({
  meta: { name: 'info', description: '获取用户信息' },
  args: { id: { type: 'positional', description: '用户 UID', required: true } },
  async run({ args }) {
    const user = await sdk().users.getById(args.id)
    console.log(JSON.stringify(user, null, 2))
  },
})

export const userTimeline = defineCommand({
  meta: { name: 'timeline', description: '获取用户微博时间线' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    since_id: { type: 'string', description: '分页游标' },
    count: { type: 'string', description: '每页条数' },
  },
  async run({ args }) {
    const page = await sdk().tweets.listByUserId(args.id, {
      sinceId: args.since_id ? Number(args.since_id) : undefined,
      count: args.count ? Number(args.count) : undefined,
    })
    console.log(JSON.stringify(page, null, 2))
  },
})
