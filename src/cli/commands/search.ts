import { defineCommand } from 'citty'
import { WeiboSDK } from '../../WeiboSDK'

function sdk(cookie?: string) {
  return new WeiboSDK({ cookie: cookie || process.env.WEIBO_COOKIE || '', selfCheck: { mode: 'lazy' } })
}

export const searchUsers = defineCommand({
  meta: { name: 'users', description: '搜索用户' },
  args: {
    query: { type: 'positional', description: '搜索关键词', required: true },
    page: { type: 'string', description: '页码' },
    cookie: { type: 'string', description: '微博 Cookie' },
  },
  async run({ args }) {
    const raw = await sdk(args.cookie as string).search.searchUsers(
      args.query,
      args.page ? Number(args.page) : undefined,
    )
    console.log(JSON.stringify(raw, null, 2))
  },
})

export const searchTweets = defineCommand({
  meta: { name: 'tweets', description: '搜索微博' },
  args: {
    query: { type: 'positional', description: '搜索关键词', required: true },
    page: { type: 'string', description: '页码' },
    cookie: { type: 'string', description: '微博 Cookie' },
  },
  async run({ args }) {
    const raw = await sdk(args.cookie as string).search.searchTweets(
      args.query,
      args.page ? Number(args.page) : undefined,
    )
    console.log(JSON.stringify(raw, null, 2))
  },
})
