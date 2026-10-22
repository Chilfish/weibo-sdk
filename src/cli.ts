import type {
  ArchiveCheckpoint,
  ArchiveIncrementalOptions,
  ArchiveProgress,
} from './services/public/ArchiveService'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import pkg from '../package.json' with { type: 'json' }
import { listCapabilities } from './capabilities'
import { runArchiveMerge } from './cli/commands/archiveMerge'
import { runArchiveUser } from './cli/commands/archiveUser'
import { commentMine, commentStream } from './cli/commands/comment'
import {
  favoriteList,
  favoriteStream,
  favoriteTags,
} from './cli/commands/favorite'
import {
  followFans,
  followFansStream,
  followList,
  followMy,
  followMyStream,
  followStream,
} from './cli/commands/follow'
import { likeList, likeStream } from './cli/commands/like'
import {
  mediaAlbum,
  mediaAlbums,
  mediaDownload,
  mediaImages,
  mediaVideos,
} from './cli/commands/media'
import {
  notificationComments,
  notificationCommentsStream,
  notificationLikes,
  notificationLikesStream,
} from './cli/commands/notification'
import { searchTweets, searchUsers } from './cli/commands/search'
import { topicCates, topicList, topicStream } from './cli/commands/topic'
import {
  tweetComments,
  tweetCommentsStream,
  tweetContext,
  tweetDetail,
  tweetEnrich,
  tweetHomeStream,
  tweetLikers,
  tweetLikersStream,
  tweetLongtext,
  tweetReplies,
  tweetRepliesStream,
  tweetReposts,
  tweetRepostsStream,
  tweetSearchProfile,
  tweetTimeline,
} from './cli/commands/tweet'
import {
  userGroups,
  userInfo,
  userMblogGroups,
  userMentions,
  userMentionsStream,
  userTimeline,
  userTimelineStream,
} from './cli/commands/user'
import { createPrinter, outputFormatArg } from './cli/output'
import {
  cookieArg,
  createSDK,
  formatCliError,
  resolveArchiveIncludeFlags,
} from './cli/shared'
import { WeiboSessionExpiredError } from './models/errors/BusinessError'
import { renderTrendListMarkdown } from './models/view/Collections'
import { renderGuestSessionMarkdown } from './models/view/Session'
import { renderUserMarkdown } from './models/view/User'
import {
  incrementalOptionsFromState,
  parseArchiveState,
  updateArchiveState,
} from './utils/archiveState'
import { diffSchemaDigest, formatSchemaDrift } from './utils/schemaDrift'

const trends = defineCommand({
  meta: { name: 'trends', description: '获取热搜榜单' },
  args: {
    type: {
      type: 'string',
      description: '榜单类型：hot/topic/entertainment（默认 hot）',
    },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const type = args.type as 'hot' | 'topic' | 'entertainment' | undefined
    const raw = await createSDK(args).trends.hotBand(type)
    print(raw, {
      markdown: value => renderTrendListMarkdown(value.data.realtime ?? [], {
        title: `热搜榜（${type ?? 'hot'}）`,
      }),
    })
  },
})

const whoami = defineCommand({
  meta: {
    name: 'whoami',
    description:
      '查看当前登录用户信息（无 Cookie 时自动走访客身份，输出访客 token 状态；--guest 强制访客）',
  },
  args: { ...outputFormatArg, ...cookieArg },
  async run({ args }) {
    const print = createPrinter(args)
    const sdk = createSDK(args)
    // 失败（Cookie 过期 / 访客 token 发放失败）由统一错误信封输出。
    const session = await sdk.getSession()

    if (sdk.authMode === 'guest') {
      // 只输出 token 元信息（issuedAt / scope / source），永远不打印 token 明文。
      const token = await sdk.getGuestTokenStatus()
      print(
        {
          auth: 'guest',
          login: false,
          tokenIssuedAt: session.guestTokenIssuedAt ?? null,
          token,
        },
        { markdown: () => renderGuestSessionMarkdown(token) },
      )
      return
    }

    const details = session.details ?? (await sdk.users.myDetails())
    if (details.ok !== 1) {
      throw new WeiboSessionExpiredError('Cookie 无效或已过期', {
        endpoint: 'ajax/profile/info',
      })
    }

    // uid 由 SDK 会话解析（`data.verified_url` 的 `uid=`），避免 CLI 重复解析。
    if (session.uid) {
      const user = await sdk.users.getById(session.uid)
      print(user, { markdown: renderUserMarkdown })
      return
    }

    // 极少数会话无法解析 uid：没有 User 模型可渲染，把 raw 详情放进代码块。
    print(details, {
      markdown: value => `# 当前登录账号\n\n无法从会话解析 uid，原始详情：\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
    })
  },
})

function readUidFile(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line !== '' && !line.startsWith('#')),
    ),
  ]
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  catch {
    return undefined
  }
}

const schemaDiff = defineCommand({
  meta: {
    name: 'diff',
    description:
      '对比两个 schemaDigest / 结构快照，输出字段新增 / 删除 / 类型变化',
  },
  args: {
    before: {
      type: 'positional',
      description: '旧结构快照 JSON 文件',
      required: true,
    },
    after: {
      type: 'positional',
      description: '新结构快照 JSON 文件',
      required: true,
    },
  },
  async run({ args }) {
    const beforePath = join(process.cwd(), args.before)
    const afterPath = join(process.cwd(), args.after)
    const before = readJsonFile(beforePath)
    const after = readJsonFile(afterPath)
    if (before === undefined || after === undefined) {
      console.error(
        JSON.stringify({
          event: 'error',
          code: 'SCHEMA_DIFF_INPUT',
          message: `无法读取 JSON：${before === undefined ? beforePath : afterPath}`,
        }),
      )
      process.exit(1)
    }

    const changes = diffSchemaDigest(before, after)
    console.log(
      JSON.stringify(
        {
          before: beforePath,
          after: afterPath,
          summary: {
            added: changes.filter(change => change.kind === 'added').length,
            removed: changes.filter(change => change.kind === 'removed')
              .length,
            changed: changes.filter(change => change.kind === 'type_changed')
              .length,
          },
          changes,
          report: formatSchemaDrift(changes),
        },
        null,
        2,
      ),
    )
  },
})

const archive = defineCommand({
  meta: {
    name: 'archive',
    description:
      '镜像微博账号（timeline + 日期切片 + reposts + favorites + 媒体，可断点续传 / 增量 / 批量）\n'
      + '范围归档：weibo-cli archive user <uid> --since 2025-01-01 --until 2025-12-31 -o ./archive.json\n'
      + '合并归档：weibo-cli archive merge a.json b.json -o ./merged.json\n'
      + '注意：--guest 不支持归档（访客只有匿名首屏数据），SDK 会以 CONFIG_INVALID 拒绝',
  },
  args: {
    'uid': {
      type: 'positional',
      description: '用户 UID（与 --uid-file 二选一）',
      required: false,
    },
    'uid-file': {
      type: 'string',
      description: '批量归档的 UID 文件（每行一个，# 开头为注释）',
    },
    'reposts': {
      type: 'boolean',
      default: true,
      description: '归档转发（--no-reposts 跳过）',
    },
    'favorites': {
      type: 'boolean',
      description: '归档收藏（仅登录账号自身；单账号默认开启，批量需显式 --favorites）',
    },
    'likes': {
      type: 'boolean',
      default: false,
      description: '归档我赞过的微博（includeLikes）',
    },
    'comment-history': {
      type: 'boolean',
      default: false,
      description: '归档当前用户历史评论（仅登录账号自身；includeCommentHistory）',
    },
    'images': {
      type: 'boolean',
      default: false,
      description: '归档用户图片墙（includeImages）',
    },
    'videos': {
      type: 'boolean',
      default: false,
      description: '归档用户视频瀑布（includeVideos）',
    },
    'original-only': {
      type: 'boolean',
      default: false,
      description: '仅归档原创微博（跳过转发与内联转发）',
    },
    'date-slices': {
      type: 'boolean',
      default: true,
      description: '日期切片补齐（--no-date-slices 跳过）',
    },
    'source': {
      type: 'string',
      description: 'timeline 数据源：mymblog（默认）或 search（直接日期切片）',
    },
    'since': { type: 'string', description: '日期切片下界（unix 秒，可选）；archive user 也作为范围起点' },
    'until': { type: 'string', description: 'archive user：范围终点（YYYY-MM-DD / YYYYMMDD / unix 秒；默认现在）' },
    'incremental-since': {
      type: 'string',
      description: '增量时间下界：YYYY-MM-DD / YYYYMMDD 或 unix 秒',
    },
    'stop-at': {
      type: 'string',
      description: '增量早停：遇到该 mblogId 即停止（不产出该条）',
    },
    'skip-pinned': {
      type: 'boolean',
      default: false,
      description: '增量模式下跳过置顶微博',
    },
    'state': {
      type: 'string',
      description: '增量状态文件路径（如 .weibo-archive-state.json）',
    },
    'comments': {
      type: 'boolean',
      description: '拉取并挂载评论到 tweet.comments（默认关闭）',
    },
    'comment-pages': {
      type: 'string',
      description: '每条微博最多评论页数（默认不限）',
    },
    'concurrency': {
      type: 'string',
      description: '并发窗口（archive 默认 3；archive user 默认 20，上限 32）',
    },
    'max-retries': {
      type: 'string',
      description: '可重试错误的最大重试次数（默认 1）',
    },
    'repost-policy': {
      type: 'string',
      description: '转发页失败策略：abort/skip/retry（默认 skip）',
    },
    'comments-policy': {
      type: 'string',
      description: '评论失败策略：abort/skip/retry（默认 skip）',
    },
    'checkpoint': {
      type: 'string',
      description:
        'checkpoint 文件路径（仅单账号；默认 .weibo-sdk-archive-<uid>.json）',
    },
    'max-pages': { type: 'string', description: '每阶段最大翻页数（测试用）' },
    // archive user 的范围归档参数；旧的 archive <uid> 路径会忽略这些参数。
    'out': { type: 'string', alias: 'o', description: 'archive user / merge 的输出文件' },
    'force': { type: 'boolean', default: false, description: 'archive user / merge：覆盖已存在的输出 / raw 文件' },
    'merge': { type: 'boolean', default: false, description: 'archive user：把已存在的输出文件作为基线合并（增量更新）' },
    'fresh': { type: 'boolean', default: false, description: 'archive user：丢弃已有切片进度' },
    'raw': { type: 'boolean', default: false, description: 'archive user：把原始响应写到 <out>.raw.ndjson' },
    'raw-out': { type: 'string', description: 'archive user：自定义 raw JSONL 路径' },
    'no-comments': { type: 'boolean', default: false, description: 'archive user：不拉评论区' },
    'no-replies': { type: 'boolean', default: false, description: 'archive user：只拉一级评论' },
    'comment-order': { type: 'string', default: 'time', description: 'archive user：评论排序 time / hot' },
    'max-comments': { type: 'string', description: 'archive user：每条微博最多一级评论数' },
    'max-comment-pages': { type: 'string', description: 'archive user：每条微博最多评论页数' },
    'max-replies': { type: 'string', description: 'archive user：每条一级评论最多楼中楼数' },
    'max-reply-pages': { type: 'string', description: 'archive user：每条一级评论最多楼中楼页数' },
    'max-reposts': { type: 'string', description: 'archive user：每条微博最多转发数' },
    'max-repost-pages': { type: 'string', description: 'archive user：每条微博最多转发页数' },
    'slice-days': { type: 'string', description: 'archive user：每 n 天一个枚举子任务（默认 30；0 = 不拆分）' },
    'delay': { type: 'string', description: 'archive user：令牌补充间隔毫秒（默认 300）' },
    'burst': { type: 'string', description: 'archive user：令牌桶容量（默认 8）' },
    'dotenv': { type: 'string', description: 'archive user：同 --env-file（兼容旧脚本）' },
    'log-format': { type: 'string', description: 'archive user：日志呈现 pretty | ndjson | silent（TTY 默认 pretty，管道 / CI 默认 ndjson）' },
    'no-progress': { type: 'boolean', default: false, description: 'archive user：关闭动态状态行，只输出关键行' },
    'quiet': { type: 'boolean', default: false, description: 'archive user：不输出诊断，等价于 --log-format silent' },
    ...cookieArg,
  },
  async run({ args, rawArgs }) {
    // `archive user` 走范围归档；旧的 `archive <uid>` / `--uid-file` 保持原行为。
    const positionals = Array.isArray(args._) ? args._ : []
    if (positionals[0] === 'user') {
      const target = positionals[1]
      if (!target) {
        console.error('❌ archive user 需要一个用户 UID')
        process.exit(1)
      }
      await runArchiveUser({
        ...args,
        uid: target,
        __rawArgs: rawArgs,
      })
      return
    }

    if (positionals[0] === 'merge') {
      await runArchiveMerge(positionals.slice(1), args)
      return
    }

    const uid = typeof args.uid === 'string' ? args.uid : undefined
    const uidFile
      = typeof args['uid-file'] === 'string' ? args['uid-file'] : undefined
    if (!uid && !uidFile) {
      console.error('❌ 需要一个用户 UID 或 --uid-file <path>')
      process.exit(1)
    }

    const uids = uidFile ? readUidFile(join(process.cwd(), uidFile)) : [uid!]
    if (uids.length === 0) {
      console.error(`❌ ${uidFile} 中没有可用 UID`)
      process.exit(1)
    }
    const single = uids.length === 1
    const explicitCheckpoint
      = typeof args.checkpoint === 'string' ? args.checkpoint : undefined
    const checkpointPath = (targetUid: string): string =>
      explicitCheckpoint && single
        ? explicitCheckpoint
        : join(process.cwd(), `.weibo-sdk-archive-${targetUid}.json`)

    const statePath = args.state ? join(process.cwd(), args.state) : undefined
    let state = statePath
      ? parseArchiveState(readJsonFile(statePath))
      : undefined

    const source = args.source === 'search' ? 'search' : 'mymblog'
    const errorAction = (
      value: unknown,
    ): 'abort' | 'skip' | 'retry' | undefined =>
      value === 'abort' || value === 'skip' || value === 'retry'
        ? value
        : undefined

    // 显式增量参数优先于状态文件；两者按字段合并（例如状态提供 stopAt、命令行只覆盖 since）。
    const incrementalOverride = {
      ...(args['incremental-since']
        ? { since: args['incremental-since'] as string }
        : {}),
      ...(args['stop-at'] ? { stopAtMblogId: args['stop-at'] as string } : {}),
      ...(args['skip-pinned'] ? { skipPinned: true } : {}),
    }
    const getIncremental = (
      targetUid: string,
    ): ArchiveIncrementalOptions | undefined => {
      const fromState = state
        ? incrementalOptionsFromState(state, targetUid)
        : undefined
      const merged = { ...(fromState ?? {}), ...incrementalOverride }
      return Object.keys(merged).length > 0 ? merged : undefined
    }

    let latestProgress: ArchiveProgress | undefined
    const stream = createSDK(args).archive.streamUsersArchive(uids, {
      ...resolveArchiveIncludeFlags(args, { batch: !single }),
      includeLikes: !!args.likes,
      includeCommentHistory: !!args['comment-history'],
      includeImages: !!args.images,
      includeVideos: !!args.videos,
      originalOnly: !!args['original-only'],
      timelineSource: source,
      since: args.since ? Number(args.since) : undefined,
      includeComments: !!args.comments,
      maxCommentPagesPerTweet: args['comment-pages']
        ? Number(args['comment-pages'])
        : undefined,
      concurrency: args.concurrency ? Number(args.concurrency) : undefined,
      maxRetries: args['max-retries'] ? Number(args['max-retries']) : undefined,
      repostErrorPolicy: errorAction(args['repost-policy']),
      commentsErrorPolicy: errorAction(args['comments-policy']),
      maxPagesPerPhase: args['max-pages']
        ? Number(args['max-pages'])
        : undefined,
      getCheckpoint: targetUid =>
        readJsonFile(checkpointPath(targetUid)) as
          ArchiveCheckpoint | undefined,
      getIncremental,
      onProgress: (progress) => {
        latestProgress = progress
        console.log(
          JSON.stringify({
            event: 'progress',
            uid: progress.uid,
            phase: progress.phase,
            source: progress.source,
            processed: progress.processed,
            total: progress.total,
            remaining: progress.remaining,
            page: progress.page,
          }),
        )
      },
      onItemError: (error, context) => {
        console.error(
          JSON.stringify({
            event: 'item-error',
            uid: context.uid,
            stage: context.stage,
            source: context.source,
            mblogId: context.mblogId,
            parentMblogId: context.parentMblogId,
            page: context.page,
            message: error instanceof Error ? error.message : String(error),
          }),
        )
        return undefined
      },
      onUserDone: (targetUid, count) => {
        console.log(
          JSON.stringify({ event: 'user-done', uid: targetUid, count }),
        )
      },
      onUserError: (targetUid, error) => {
        console.error(
          JSON.stringify({
            event: 'user-error',
            uid: targetUid,
            message: error instanceof Error ? error.message : String(error),
          }),
        )
        return single ? 'abort' : 'skip'
      },
    })

    let last: { uid: string, checkpoint: ArchiveCheckpoint } | undefined
    let count = 0
    try {
      for await (const { uid: currentUid, item } of stream) {
        last = { uid: currentUid, checkpoint: item.checkpoint }
        // 每产出一项即落盘，进程被中断（Ctrl+C）时仍可从最近进度续跑。
        writeFileSync(
          checkpointPath(currentUid),
          JSON.stringify(item.checkpoint, null, 2),
        )
        if (state && statePath) {
          state = updateArchiveState(state, currentUid, item)
          writeFileSync(statePath, JSON.stringify(state, null, 2))
        }
        count += 1
        console.log(
          JSON.stringify({
            event: 'item',
            ...(single ? {} : { uid: currentUid }),
            schemaVersion: item.schemaVersion,
            source: item.source,
            mblogId: item.mblogId,
            assetId: item.asset?.id,
            tweetId: item.tweet?.id,
            count,
            total: latestProgress?.total,
            remaining: latestProgress?.remaining,
            checkpoint: item.checkpoint,
          }),
        )
      }
      console.log(
        JSON.stringify({
          event: 'done',
          ...(single ? { uid: uids[0] } : { uids }),
          count,
          total: latestProgress?.total,
          remaining: latestProgress?.remaining,
        }),
      )
    }
    catch (e: any) {
      console.error(JSON.stringify(formatCliError(e)))
      if (last) {
        writeFileSync(
          checkpointPath(last.uid),
          JSON.stringify(last.checkpoint, null, 2),
        )
      }
      process.exit(1)
    }
  },
})

const capabilities = defineCommand({
  meta: {
    name: 'capabilities',
    description: '列出 SDK 能力（服务 / 方法 / 登录要求 / 分页 / 状态）',
  },
  args: {
    service: {
      type: 'string',
      description: '按服务过滤（如 tweets / archive）',
    },
    status: {
      type: 'string',
      description: '按状态过滤：stable / degraded / unavailable / planned',
    },
  },
  async run({ args }) {
    const filter = {
      ...(args.service ? { service: args.service } : {}),
      ...(args.status ? { status: args.status as any } : {}),
    }
    console.log(JSON.stringify(listCapabilities(filter), null, 2))
  },
})

export const main = defineCommand({
  meta: {
    name: 'weibo-cli',
    version: pkg.version,
    description:
      '微博 API 逆向 SDK 命令行工具\n\nCookie：从 .env 文件读取（默认 <pwd>/.env，可用 --env-file 指定；--cookie/-c 显式覆盖）\n访客：任一命令均支持 --guest（使用访客身份，不读取 .env Cookie，仅公开数据）',
  },
  subCommands: {
    user: defineCommand({
      meta: { name: 'user', description: '用户相关操作' },
      subCommands: {
        'info': userInfo,
        'timeline': userTimeline,
        'timeline-stream': userTimelineStream,
        'mentions': userMentions,
        'mentions-stream': userMentionsStream,
        'groups': userGroups,
        'mblog-groups': userMblogGroups,
      },
    }),
    tweet: defineCommand({
      meta: { name: 'tweet', description: '微博相关操作' },
      subCommands: {
        'detail': tweetDetail,
        'context': tweetContext,
        'enrich': tweetEnrich,
        'comments': tweetComments,
        'comments-stream': tweetCommentsStream,
        'replies': tweetReplies,
        'replies-stream': tweetRepliesStream,
        'home': tweetTimeline,
        'home-stream': tweetHomeStream,
        'likers': tweetLikers,
        'likers-stream': tweetLikersStream,
        'longtext': tweetLongtext,
        'reposts': tweetReposts,
        'reposts-stream': tweetRepostsStream,
        'search-profile': tweetSearchProfile,
      },
    }),
    follow: defineCommand({
      meta: { name: 'follow', description: '关注列表' },
      subCommands: {
        'list': followList,
        'fans': followFans,
        'my': followMy,
        'stream': followStream,
        'fans-stream': followFansStream,
        'my-stream': followMyStream,
      },
    }),
    favorite: defineCommand({
      meta: { name: 'favorite', description: '收藏夹' },
      subCommands: {
        list: favoriteList,
        stream: favoriteStream,
        tags: favoriteTags,
      },
    }),
    like: defineCommand({
      meta: { name: 'like', description: '我赞过的微博' },
      subCommands: { list: likeList, stream: likeStream },
    }),
    comment: defineCommand({
      meta: { name: 'comment', description: '当前登录用户的历史评论' },
      subCommands: { mine: commentMine, stream: commentStream },
    }),
    media: defineCommand({
      meta: {
        name: 'media',
        description:
          '媒体集合与下载（图片墙 / 相册 / 视频瀑布 / 单条微博下载）',
      },
      subCommands: {
        images: mediaImages,
        albums: mediaAlbums,
        album: mediaAlbum,
        videos: mediaVideos,
        download: mediaDownload,
      },
    }),
    topic: defineCommand({
      meta: { name: 'topic', description: '超话分类 / 列表 / 关键词搜索' },
      subCommands: { cates: topicCates, list: topicList, stream: topicStream },
    }),
    notification: defineCommand({
      meta: { name: 'notification', description: '消息通知（评论 / 点赞）' },
      subCommands: {
        'comments': notificationComments,
        'comments-stream': notificationCommentsStream,
        'likes': notificationLikes,
        'likes-stream': notificationLikesStream,
      },
    }),
    search: defineCommand({
      meta: { name: 'search', description: '搜索' },
      subCommands: { users: searchUsers, tweets: searchTweets },
    }),
    schema: defineCommand({
      meta: { name: 'schema', description: 'schemaDigest 结构漂移检测' },
      subCommands: { diff: schemaDiff },
    }),
    trends,
    whoami,
    archive,
    capabilities,
  },
})

/** 递归包装所有命令的 run：未捕获错误统一输出 JSON 错误信封。 */
export function withErrorEnvelope<
  T extends {
    run?: (...args: any[]) => any
    subCommands?: Record<string, any>
  },
>(command: T): T {
  if (command.run) {
    const run = command.run
    command.run = async (...args: any[]) => {
      try {
        return await run(...args)
      }
      catch (error) {
        console.error(JSON.stringify(formatCliError(error)))
        process.exit(1)
      }
    }
  }
  for (const sub of Object.values(command.subCommands ?? {}))
    withErrorEnvelope(sub)
  return command
}
