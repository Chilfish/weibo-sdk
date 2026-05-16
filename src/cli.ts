// Auto-load .env file (Node.js 21.7+)
try { process.loadEnvFile() } catch { /* ignore */ }

import { defineCommand, runMain } from 'citty'
import { cookieArg, createSDK, getCookie } from './cli/shared'
import { userInfo, userTimeline } from './cli/commands/user'
import { tweetDetail, tweetComments, tweetTimeline } from './cli/commands/tweet'
import { searchUsers, searchTweets } from './cli/commands/search'

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
    // Extract UID from SUB= cookie value
    const subMatch = cookie.match(/SUB=_2A[A-Za-z0-9]+_(\d+)/)
    const uidFromCookie = subMatch ? subMatch[1] : null

    const sdk = createSDK(args)
    try {
      // Try myDetails first to verify cookie validity
      const details = await sdk.users.myDetails()
      if (details.ok !== 1) {
        console.error('❌ Cookie 无效或已过期')
        process.exit(1)
      }

      if (uidFromCookie) {
        const user = await sdk.users.getById(uidFromCookie)
        console.log(JSON.stringify(user, null, 2))
      } else {
        // Fallback: output raw myDetails if UID extraction fails
        console.log(JSON.stringify(details, null, 2))
      }
    } catch (e: any) {
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
      subCommands: { detail: tweetDetail, comments: tweetComments, home: tweetTimeline },
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
