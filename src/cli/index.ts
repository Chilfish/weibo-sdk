import { defineCommand, runMain } from 'citty'
import { WeiboSDK } from '../WeiboSDK'
import { userInfo, userTimeline } from './commands/user'
import { tweetDetail, tweetComments, tweetTimeline } from './commands/tweet'
import { searchUsers, searchTweets } from './commands/search'

const trends = defineCommand({
  meta: { name: 'trends', description: '获取热搜榜单' },
  async run() {
    const sdk = new WeiboSDK({ cookie: process.env.WEIBO_COOKIE || '', selfCheck: { mode: 'lazy' } })
    const raw = await sdk.trends.hotBand()
    console.log(JSON.stringify(raw, null, 2))
  },
})

const selfCheck = defineCommand({
  meta: { name: 'self-check', description: '验证 Cookie 会话有效性' },
  async run() {
    const cookie = process.env.WEIBO_COOKIE || ''
    if (!cookie) {
      console.error('❌ 请设置 WEIBO_COOKIE 环境变量')
      process.exit(1)
    }
    const sdk = new WeiboSDK({ cookie })
    try {
      await sdk.selfCheck()
      console.log('✅ Cookie 有效')
    } catch (e: any) {
      console.error(`❌ Cookie 无效: ${e.message}`)
      process.exit(1)
    }
  },
})

const main = defineCommand({
  meta: {
    name: 'weibo-sdk',
    version: '0.1.0',
    description: '微博 API 逆向 SDK 命令行工具\n\n认证：设置 WEIBO_COOKIE 环境变量（或 .env 文件）',
  },
  subCommands: {
    user: defineCommand({
      meta: { name: 'user', description: '用户相关操作' },
      subCommands: { info: userInfo, timeline: userTimeline },
    }),
    tweet: defineCommand({
      meta: { name: 'tweet', description: '微博相关操作' },
      subCommands: { detail: tweetDetail, comments: tweetComments, home: tweetTimeline },
    }),
    search: defineCommand({
      meta: { name: 'search', description: '搜索' },
      subCommands: { users: searchUsers, tweets: searchTweets },
    }),
    trends,
    'self-check': selfCheck,
  },
})

runMain(main)
