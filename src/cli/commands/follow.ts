import { defineCommand } from 'citty'
import { cookieArg, createSDK } from '../shared'

export const followList = defineCommand({
  meta: { name: 'list', description: '获取用户关注列表（cursor 分页）' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    page: { type: 'string', description: '分页（可选）' },
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).followings.getFollowings(
      args.id,
      args.page ? Number(args.page) : undefined,
    )
    console.log(JSON.stringify(raw, null, 2))
  },
})

export const followMy = defineCommand({
  meta: { name: 'my', description: '获取自己的关注列表（cursor 分页）' },
  args: {
    page: { type: 'string', description: '分页（可选）' },
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).followings.getMyFollowings(
      args.page ? Number(args.page) : undefined,
    )
    console.log(JSON.stringify(raw, null, 2))
  },
})
