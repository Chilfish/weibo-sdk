// Auto-load .env file (Node.js 21.7+)
import { defineCommand, runMain } from 'citty'
import { favoriteList } from './cli/commands/favorite'
import { followList, followMy } from './cli/commands/follow'
import { searchTweets, searchUsers } from './cli/commands/search'
import { tweetComments, tweetDetail, tweetLongtext, tweetSearchProfile, tweetTimeline } from './cli/commands/tweet'
import { userInfo, userTimeline } from './cli/commands/user'
import { cookieArg, createSDK, getCookie } from './cli/shared'

try {
  process.loadEnvFile()
}
catch {
  // .env file not found — use env vars directly
}

const trends = defineCommand({
  meta: { name: 'trends', description: '获取热搜榜单' },
  args: { ...cookieArg },
  async run({ args }) {
    const raw = await createSDK(args).trends.hotBand()
    console.log(JSON.stringify(raw, null, 2))
  },
})

const whoami = defineCommand({
  meta: { name: 'whoami', description: '查看当前登录用户信息' },
  args: { ...cookieArg },
  async run({ args }) {
    const cookie = getCookie(args)
    if (!cookie) {
      console.error('❌ 请设置 WEIBO_COOKIE 环境变量或通过 --cookie 参数传入')
      process.exit(1)
    }
    const sdk = createSDK(args)
    try {
      const details = await sdk.users.myDetails()
      if (details.ok !== 1) {
        console.error('❌ Cookie 无效或已过期')
        process.exit(1)
      }

      // Extract UID from verified_url: "https://verified.weibo.com/verify?fr=myverified?uid=7679065628"
      const verifiedUrl = (details.data as any)?.verified_url as string | undefined
      const uidMatch = verifiedUrl?.match(/uid=(\d+)/)
      const uid = uidMatch ? uidMatch[1] : null

      if (uid) {
        const user = await sdk.users.getById(uid)
        console.log(JSON.stringify(user, null, 2))
      }
      else {
        console.log(JSON.stringify(details, null, 2))
      }
    }
    catch (e: any) {
      console.error(`❌ 请求失败: ${e.message}`)
      process.exit(1)
    }
  },
})

const main = defineCommand({
  meta: {
    name: 'weibo-sdk',
    version: '0.1.0',
    description: '微博 API 逆向 SDK 命令行工具\n\nCookie：通过 --cookie/-c 参数或 WEIBO_COOKIE 环境变量 / .env 文件',
  },
  subCommands: {
    user: defineCommand({
      meta: { name: 'user', description: '用户相关操作' },
      subCommands: { info: userInfo, timeline: userTimeline },
    }),
    tweet: defineCommand({
      meta: { name: 'tweet', description: '微博相关操作' },
      subCommands: { 'detail': tweetDetail, 'comments': tweetComments, 'home': tweetTimeline, 'longtext': tweetLongtext, 'search-profile': tweetSearchProfile },
    }),
    follow: defineCommand({
      meta: { name: 'follow', description: '关注列表' },
      subCommands: { list: followList, my: followMy },
    }),
    favorite: defineCommand({
      meta: { name: 'favorite', description: '收藏夹' },
      subCommands: { list: favoriteList },
    }),
    search: defineCommand({
      meta: { name: 'search', description: '搜索' },
      subCommands: { users: searchUsers, tweets: searchTweets },
    }),
    trends,
    whoami,
  },
})

runMain(main)
