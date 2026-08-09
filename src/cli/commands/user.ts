import { defineCommand } from 'citty'
import { cookieArg, createSDK } from '../shared'

export const userInfo = defineCommand({
  meta: { name: 'info', description: '获取用户信息' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    ...cookieArg,
  },
  async run({ args }) {
    const user = await createSDK(args).users.getById(args.id)
    console.log(JSON.stringify(user, null, 2))
  },
})

export const userTimeline = defineCommand({
  meta: { name: 'timeline', description: '获取用户微博时间线' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    since_id: { type: 'string', description: '分页游标', alias: 's' },
    count: { type: 'string', description: '每页条数' },
    ...cookieArg,
  },
  async run({ args }) {
    const page = await createSDK(args).tweets.listByUserId(args.id, {
      sinceId: args.since_id,
      count: args.count ? Number(args.count) : undefined,
    })
    console.log(JSON.stringify(page, null, 2))
  },
})
