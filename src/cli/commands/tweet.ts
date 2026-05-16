import { defineCommand } from 'citty'
import { WeiboSDK } from '../../WeiboSDK'
import type { IWeiboConfig } from '../../types/config'

function sdk(cookie?: string) {
  return new WeiboSDK({ cookie: cookie || process.env.WEIBO_COOKIE || '', selfCheck: { mode: 'lazy' } })
}

export const tweetDetail = defineCommand({
  meta: { name: 'detail', description: '获取微博详情' },
  args: {
    id: { type: 'positional', description: '微博 mblogId', required: true },
    cookie: { type: 'string', description: '微博 Cookie' },
  },
  async run({ args }) {
    const tweet = await sdk(args.cookie as string).tweets.getByMblogId(args.id)
    console.log(JSON.stringify(tweet, null, 2))
  },
})

export const tweetComments = defineCommand({
  meta: { name: 'comments', description: '获取微博评论' },
  args: {
    id: { type: 'positional', description: '微博 mblogId', required: true },
    count: { type: 'string', description: '每页条数' },
    flow: { type: 'string', description: '排序：0=热度 1=时间' },
    cookie: { type: 'string', description: '微博 Cookie' },
  },
  async run({ args }) {
    const raw = await sdk(args.cookie as string).tweets.comments(args.id, {
      count: args.count ? Number(args.count) : undefined,
      flow: args.flow ? (Number(args.flow) as 0 | 1) : undefined,
    })
    console.log(JSON.stringify(raw, null, 2))
  },
})

export const tweetTimeline = defineCommand({
  meta: { name: 'home', description: '获取首页 Feed（关注时间线）' },
  args: {
    since_id: { type: 'string', description: '分页游标' },
    count: { type: 'string', description: '每页条数' },
    cookie: { type: 'string', description: '微博 Cookie' },
  },
  async run({ args }) {
    const page = await sdk(args.cookie as string).tweets.listFriendTimeline({
      since_id: args.since_id ? Number(args.since_id) : undefined,
      count: args.count ? Number(args.count) : undefined,
    })
    console.log(JSON.stringify(page, null, 2))
  },
})
