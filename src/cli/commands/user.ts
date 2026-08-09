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
    page: { type: 'string', description: '页码（从 1 开始）', alias: 'p' },
    count: { type: 'string', description: '每页条数' },
    ...cookieArg,
  },
  async run({ args }) {
    const page = await createSDK(args).tweets.listByUserId(args.id, {
      page: args.page ? Number(args.page) : undefined,
      count: args.count ? Number(args.count) : undefined,
    })
    console.log(JSON.stringify(page, null, 2))
  },
})
