import type { ArchiveCheckpoint, ArchiveProgress } from './services/public/ArchiveService'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand, runMain } from 'citty'
import pkg from '../package.json' with { type: 'json' }
import { favoriteList, favoriteTags } from './cli/commands/favorite'
import { followFans, followList, followMy } from './cli/commands/follow'
import { searchTweets, searchUsers } from './cli/commands/search'
import { tweetComments, tweetDetail, tweetEnrich, tweetLongtext, tweetReposts, tweetSearchProfile, tweetTimeline } from './cli/commands/tweet'
import { userInfo, userTimeline } from './cli/commands/user'
import { cookieArg, createSDK, getCookie, getEnvFilePath } from './cli/shared'

const trends = defineCommand({
  meta: { name: 'trends', description: '获取热搜榜单' },
  args: {
    type: { type: 'string', description: '榜单类型：hot/topic/entertainment（默认 hot）' },
    ...cookieArg,
  },
  async run({ args }) {
    const type = args.type as 'hot' | 'topic' | 'entertainment' | undefined
    const raw = await createSDK(args).trends.hotBand(type)
    console.log(JSON.stringify(raw, null, 2))
  },
})

const whoami = defineCommand({
  meta: { name: 'whoami', description: '查看当前登录用户信息' },
  args: { ...cookieArg },
  async run({ args }) {
    const cookie = getCookie(args)
    if (!cookie) {
      console.error(`❌ 未在 ${getEnvFilePath(args)} 中找到 WEIBO_COOKIE，或通过 --cookie 参数传入`)
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

const archive = defineCommand({
  meta: { name: 'archive', description: '镜像单个微博账号（timeline + 日期切片 + reposts + favorites，可断点续传）' },
  args: {
    'uid': { type: 'positional', description: '用户 UID', required: true },
    'no-reposts': { type: 'boolean', description: '跳过转发归档' },
    'no-favorites': { type: 'boolean', description: '跳过收藏归档' },
    'no-date-slices': { type: 'boolean', description: 'mymblog 翻到底后不补 searchProfile 日期切片' },
    'source': { type: 'string', description: 'timeline 数据源：mymblog（默认）或 search（直接日期切片）' },
    'since': { type: 'string', description: '日期切片下界（unix 秒，可选）' },
    'comments': { type: 'boolean', description: '拉取并挂载评论到 tweet.comments（默认关闭）' },
    'comment-pages': { type: 'string', description: '每条微博最多评论页数（默认不限）' },
    'max-retries': { type: 'string', description: '可重试错误的最大重试次数（默认 1）' },
    'repost-policy': { type: 'string', description: '转发页失败策略：abort/skip/retry（默认 skip）' },
    'comments-policy': { type: 'string', description: '评论失败策略：abort/skip/retry（默认 skip）' },
    'checkpoint': { type: 'string', description: 'checkpoint 文件路径（默认 .weibo-sdk-archive-<uid>.json）' },
    'max-pages': { type: 'string', description: '每阶段最大翻页数（测试用）' },
    ...cookieArg,
  },
  async run({ args }) {
    const checkpointPath = args.checkpoint || join(process.cwd(), `.weibo-sdk-archive-${args.uid}.json`)

    // 断点续传：读取已有 checkpoint
    let checkpoint: ArchiveCheckpoint | undefined
    try {
      checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as ArchiveCheckpoint
    }
    catch {
      // 无 checkpoint，从头归档
    }

    const source = args.source === 'search' ? 'search' : 'mymblog'
    const errorAction = (value: unknown): 'abort' | 'skip' | 'retry' | undefined =>
      value === 'abort' || value === 'skip' || value === 'retry' ? value : undefined
    let latestProgress: ArchiveProgress | undefined
    const stream = createSDK(args).archive.streamArchive(args.uid, {
      includeReposts: !args['no-reposts'],
      includeFavorites: !args['no-favorites'],
      includeDateSlices: !args['no-date-slices'],
      timelineSource: source,
      since: args.since ? Number(args.since) : undefined,
      includeComments: !!args.comments,
      maxCommentPagesPerTweet: args['comment-pages'] ? Number(args['comment-pages']) : undefined,
      maxRetries: args['max-retries'] ? Number(args['max-retries']) : undefined,
      repostErrorPolicy: errorAction(args['repost-policy']),
      commentsErrorPolicy: errorAction(args['comments-policy']),
      onProgress: (progress) => {
        latestProgress = progress
        console.log(JSON.stringify({
          event: 'progress',
          uid: progress.uid,
          phase: progress.phase,
          source: progress.source,
          processed: progress.processed,
          total: progress.total,
          remaining: progress.remaining,
          page: progress.page,
        }))
      },
      onItemError: (error, context) => {
        console.error(JSON.stringify({
          event: 'item-error',
          stage: context.stage,
          source: context.source,
          mblogId: context.mblogId,
          parentMblogId: context.parentMblogId,
          page: context.page,
          message: error instanceof Error ? error.message : String(error),
        }))
        return undefined
      },
      maxPagesPerPhase: args['max-pages'] ? Number(args['max-pages']) : undefined,
      checkpoint,
    })

    let last: ArchiveCheckpoint | undefined
    let count = 0
    try {
      for await (const item of stream) {
        last = item.checkpoint
        count += 1
        console.log(JSON.stringify({
          event: 'item',
          schemaVersion: item.schemaVersion,
          source: item.source,
          mblogId: item.mblogId,
          tweetId: item.tweet.id,
          count,
          total: latestProgress?.total,
          remaining: latestProgress?.remaining,
          checkpoint: item.checkpoint,
        }))
      }
      console.log(JSON.stringify({
        event: 'done',
        uid: args.uid,
        count,
        total: latestProgress?.total,
        remaining: latestProgress?.remaining,
      }))
    }
    catch (e: any) {
      console.error(JSON.stringify({ event: 'error', message: e?.message }))
      if (last)
        writeFileSync(checkpointPath, JSON.stringify(last, null, 2))
      process.exit(1)
    }
  },
})

const main = defineCommand({
  meta: {
    name: 'weibo-sdk',
    version: pkg.version,
    description: '微博 API 逆向 SDK 命令行工具\n\nCookie：从 .env 文件读取（默认 <pwd>/.env，可用 --env-file 指定；--cookie/-c 显式覆盖）',
  },
  subCommands: {
    user: defineCommand({
      meta: { name: 'user', description: '用户相关操作' },
      subCommands: { info: userInfo, timeline: userTimeline },
    }),
    tweet: defineCommand({
      meta: { name: 'tweet', description: '微博相关操作' },
      subCommands: { 'detail': tweetDetail, 'enrich': tweetEnrich, 'comments': tweetComments, 'home': tweetTimeline, 'longtext': tweetLongtext, 'reposts': tweetReposts, 'search-profile': tweetSearchProfile },
    }),
    follow: defineCommand({
      meta: { name: 'follow', description: '关注列表' },
      subCommands: { list: followList, fans: followFans, my: followMy },
    }),
    favorite: defineCommand({
      meta: { name: 'favorite', description: '收藏夹' },
      subCommands: { list: favoriteList, tags: favoriteTags },
    }),
    search: defineCommand({
      meta: { name: 'search', description: '搜索' },
      subCommands: { users: searchUsers, tweets: searchTweets },
    }),
    trends,
    whoami,
    archive,
  },
})

runMain(main)
