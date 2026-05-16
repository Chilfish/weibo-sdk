import { defineCommand } from 'citty'
import { cookieArg, createSDK } from '../shared'

export const favoriteList = defineCommand({
  meta: { name: 'list', description: '获取收藏夹（按页遍历）' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    page: { type: 'string', description: '分页（可选）' },
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).favorites.getFavorites(
      args.id,
      args.page ? Number(args.page) : undefined,
    )
    console.log(JSON.stringify(raw, null, 2))
  },
})
