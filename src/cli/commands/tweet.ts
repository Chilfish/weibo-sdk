import { isAbsolute, join } from 'node:path'
import { defineCommand } from 'citty'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { formatCount, paginationNotes } from '~/models/view/format'
import { renderTweetCardMarkdown } from '~/models/view/TweetCard'
import {
  attachMediaDownloads,
  cleanTweetText,
  collectMediaOwners,
  renderTweetContextMarkdown,
} from '~/models/view/TweetContext'
import {
  renderCommentListMarkdown,
  renderLikerListMarkdown,
  renderTweetListMarkdown,
} from '~/models/view/TweetList'
import { createPrinter, outputFormatArg } from '../output'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK, streamLimitArg, streamRangeArg, streamRangeFromArgs } from '../shared'

/** `--format` 只接受 markdown / json；未知值直接报参数错误。 */
function parseContextFormat(value: unknown): 'markdown' | 'json' {
  if (value === undefined || value === '')
    return 'markdown'
  if (value === 'markdown' || value === 'md')
    return 'markdown'
  if (value === 'json')
    return 'json'
  throw new InvalidConfigError(`Unknown context format: ${String(value)}`, {
    field: 'format',
    value,
  })
}

/** 评论页的说明行：`total` 含楼中楼，不能当作剩余条数。 */
function commentPageNotes(page: {
  total?: number
  cursor?: number
  notice?: string
}): string[] {
  const notes: string[] = []
  if (page.total !== undefined)
    notes.push(`总数（含楼中楼）：${formatCount(page.total)}`)
  if (page.cursor !== undefined)
    notes.push(`下一页游标：${page.cursor}`)
  if (page.notice)
    notes.push(page.notice)
  return notes
}

/** `--comment-flow` 只接受 hot / time。 */
function parseCommentFlow(value: unknown): 'hot' | 'time' {
  if (value === undefined || value === '' || value === 'hot' || value === '0')
    return 'hot'
  if (value === 'time' || value === '1')
    return 'time'
  throw new InvalidConfigError(`Unknown comment flow: ${String(value)}`, {
    field: 'comment-flow',
    value,
  })
}

export const tweetDetail = defineCommand({
  meta: { name: 'detail', description: '获取微博详情（默认 JSON；--format markdown 输出上下文卡片）' },
  args: {
    id: { type: 'positional', description: '微博 mblogId', required: true },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const tweet = await createSDK(args).tweets.getByMblogId(args.id)
    print(tweet, { markdown: value => renderTweetCardMarkdown(value) })
  },
})

export const tweetContext = defineCommand({
  meta: {
    name: 'context',
    description:
      '生成 Agent 视角的单条微博上下文（谁说的 / 什么时候 / 正文 / 媒体归属与下载 / 转发关系 / 评论抽样 / 未知项）\n输出为确定性投影，不调用任何 LLM；默认 Markdown，--format json 输出结构化数据',
  },
  args: {
    'id': {
      type: 'positional',
      description: '微博 id：mblogId / 数字 mid / 微博状态 URL',
      required: true,
    },
    'format': {
      type: 'string',
      description: '输出格式：markdown | json（默认 markdown）',
      alias: 'f',
      default: 'markdown',
    },
    'comments': {
      type: 'string',
      description: '抽样评论条数（默认 0，不拉评论；按 --comment-flow 排序）',
    },
    'comment-flow': {
      type: 'string',
      description: '评论排序：hot | time（默认 hot；time 需要数字 mid，SDK 自动解析）',
      default: 'hot',
    },
    'author': {
      type: 'boolean',
      description: '补拉作者资料：简介 / 粉丝数 / 认证说明 / 关注关系（默认开启；--no-author 关闭）',
      default: true,
    },
    'longtext': {
      type: 'boolean',
      description: '上游标记长文时自动补拉全文（默认开启；--no-longtext 关闭）',
      default: true,
    },
    'quoted': {
      type: 'boolean',
      description: '展开转发的原微博（默认开启；--no-quoted 关闭）',
      default: true,
    },
    'chain': {
      type: 'boolean',
      description: '展开转发链（默认开启；--no-chain 关闭）',
      default: true,
    },
    'max-media': {
      type: 'string',
      description: '最多列出的媒体数（默认全部；超出部分写入 unknowns）',
    },
    'max-chars': {
      type: 'string',
      description: '单个文本字段字符上限（默认 4000；0 = 不限）',
      default: '4000',
    },
    'download-media': {
      type: 'string',
      description: '下载媒体到目录，并在上下文里回填本地路径（会为每个媒体所属微博刷新一次临时 URL）',
    },
    'overwrite': {
      type: 'boolean',
      description: '下载时覆盖已存在的同名文件（默认跳过）',
      default: false,
    },
    ...cookieArg,
  },
  async run({ args }) {
    const sdk = createSDK(args)
    const format = parseContextFormat(args.format)
    const downloadDir = typeof args['download-media'] === 'string' && args['download-media'].trim() !== ''
      ? args['download-media'].trim()
      : undefined

    const context = await sdk.tweets.context(args.id, {
      author: args.author !== false,
      comments: parsePositiveInt(args.comments),
      commentFlow: parseCommentFlow(args['comment-flow']),
      longText: args.longtext !== false,
      maxChars: parsePositiveInt(args['max-chars']),
      maxMedia: parsePositiveInt(args['max-media']),
      includeQuoted: args.quoted !== false,
      includeRepostChain: args.chain !== false,
      authMode: sdk.authMode,
    })

    if (downloadDir) {
      const dir = isAbsolute(downloadDir) ? downloadDir : join(process.cwd(), downloadDir)
      for (const owner of collectMediaOwners(context)) {
        const result = await sdk.media.downloadByMblogId(owner.mblogId, {
          dir,
          overwrite: args.overwrite === true,
          refreshExpired: true,
        })
        attachMediaDownloads(context, owner.relation, result.items)
      }
    }

    if (format === 'json')
      console.log(JSON.stringify(context, null, 2))
    else
      console.log(renderTweetContextMarkdown(context))
  },
})

export const tweetEnrich = defineCommand({
  meta: { name: 'enrich', description: '补拉微博原始响应 + 归一化模型（可选长微博全文）' },
  args: {
    'id': { type: 'positional', description: '微博 mblogId', required: true },
    'longtext': { type: 'boolean', description: '额外补拉长微博全文' },
    'no-longtext': { type: 'boolean', description: 'statuses/show 不请求长微博全文' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const result = await createSDK(args).tweets.enrich(args.id, {
      includeLongText: args.longtext,
      isGetLongText: !args['no-longtext'],
    })
    print(result, {
      markdown: (value) => {
        const card = renderTweetCardMarkdown(value.tweet, value.longText
          ? { longText: value.longText, longTextFetched: true }
          : {})
        return `${card}\n\n> 原始响应（raw）只在 \`--format json\` 中输出。`
      },
    })
  },
})

export const tweetComments = defineCommand({
  meta: { name: 'comments', description: '获取微博评论' },
  args: {
    'id': { type: 'positional', description: '微博 mblogId', required: true },
    'max-id': { type: 'string', description: '分页游标（上一页响应顶层的 max_id；可选）' },
    'count': { type: 'string', description: '每页条数（上游忽略，固定 20）' },
    'flow': { type: 'string', description: '排序：0=热度 1=时间（时间序需数字 mid，SDK 自动解析）' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const raw = await createSDK(args).tweets.comments(args.id, {
      maxId: parsePositiveInt(args['max-id']),
      count: args.count ? Number(args.count) : undefined,
      flow: args.flow ? (Number(args.flow) as 0 | 1) : undefined,
    })
    print(raw, {
      markdown: value => renderCommentListMarkdown(value.comments, {
        title: '微博评论',
        notes: commentPageNotes(value),
      }),
    })
  },
})

export const tweetCommentsStream = defineCommand({
  meta: { name: 'comments-stream', description: '流式遍历微博评论（max_id 游标 + 自动去重）' },
  args: {
    'id': { type: 'positional', description: '微博 mblogId', required: true },
    'max-id': { type: 'string', description: '起始游标（上一页 max_id；可选）' },
    'count': { type: 'string', description: '每页条数（上游忽略，固定 20）' },
    'flow': { type: 'string', description: '排序：0=热度 1=时间（时间序需数字 mid，SDK 自动解析）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamLimitArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const comment of createSDK(args).tweets.streamComments(args.id, {
      maxId: parsePositiveInt(args['max-id']),
      count: parsePositiveInt(args.count),
      flow: args.flow ? (Number(args.flow) as 0 | 1) : undefined,
      maxPages: parsePositiveInt(args['max-pages']),
      maxItems: streamRangeFromArgs(args).maxItems,
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, comment }))
    }
    console.log(JSON.stringify({ event: 'done', mblogId: args.id, count }))
  },
})

export const tweetRepostsStream = defineCommand({
  meta: { name: 'reposts-stream', description: '流式遍历微博转发（page 游标 + 自动去重）' },
  args: {
    'id': { type: 'positional', description: '微博 mblogId', required: true },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'count': { type: 'string', description: '每页条数' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamRangeArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const repost of createSDK(args).tweets.streamReposts(args.id, {
      page: parsePositiveInt(args.page),
      count: parsePositiveInt(args.count),
      maxPages: parsePositiveInt(args['max-pages']),
      ...streamRangeFromArgs(args),
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, repost }))
    }
    console.log(JSON.stringify({ event: 'done', mblogId: args.id, count }))
  },
})

export const tweetReplies = defineCommand({
  meta: { name: 'replies', description: '获取一级评论下的二级评论（is_reply=1 + rootid）' },
  args: {
    'id': { type: 'positional', description: '微博 mblogId', required: true },
    'root-id': { type: 'positional', description: '一级评论 id（ITweetComment.id）', required: true },
    'max-id': { type: 'string', description: '分页游标（上一页 max_id；可选）' },
    'count': { type: 'string', description: '每页条数' },
    'flow': { type: 'string', description: '排序：0=热度 1=时间' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const raw = await createSDK(args).tweets.replies(args.id, args['root-id'], {
      maxId: parsePositiveInt(args['max-id']),
      count: parsePositiveInt(args.count),
      flow: args.flow ? (Number(args.flow) as 0 | 1) : undefined,
    })
    print(raw, {
      markdown: value => renderCommentListMarkdown(value.comments, {
        title: '二级评论',
        notes: commentPageNotes(value),
      }),
    })
  },
})

export const tweetRepliesStream = defineCommand({
  meta: { name: 'replies-stream', description: '流式遍历二级评论（max_id 游标 + 自动去重）' },
  args: {
    'id': { type: 'positional', description: '微博 mblogId', required: true },
    'root-id': { type: 'positional', description: '一级评论 id（ITweetComment.id）', required: true },
    'max-id': { type: 'string', description: '起始游标（上一页 max_id；可选）' },
    'count': { type: 'string', description: '每页条数' },
    'flow': { type: 'string', description: '排序：0=热度 1=时间' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamLimitArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const comment of createSDK(args).tweets.streamReplies(args.id, args['root-id'], {
      maxId: parsePositiveInt(args['max-id']),
      count: parsePositiveInt(args.count),
      flow: args.flow ? (Number(args.flow) as 0 | 1) : undefined,
      maxPages: parsePositiveInt(args['max-pages']),
      maxItems: streamRangeFromArgs(args).maxItems,
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, comment }))
    }
    console.log(JSON.stringify({ event: 'done', mblogId: args.id, rootCommentId: args['root-id'], count }))
  },
})

export const tweetTimeline = defineCommand({
  meta: { name: 'home', description: '获取首页「最新微博」关注时间线（max_id 翻旧页）' },
  args: {
    'max-id': { type: 'string', description: '翻旧页游标（上一页 maxId；缺省第一页）' },
    'since-id': { type: 'string', description: '增量过滤：只取比该微博 id 更新的条目（单页）' },
    'list-id': { type: 'string', description: '关注分组 id（可选；如「最新微博」= 11000 + uid）' },
    'fid': { type: 'string', description: '分组过滤参数（可选，通常与 list-id 相同）' },
    'refresh': { type: 'string', description: '刷新标记（可选，实测不影响结果）' },
    'count': { type: 'string', description: '每页条数（上游实测忽略，固定 25）' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const page = await createSDK(args).tweets.listFriendTimeline({
      maxId: args['max-id'],
      sinceId: args['since-id'],
      listId: args['list-id'],
      fid: args.fid,
      refresh: args.refresh ? Number(args.refresh) : undefined,
      count: parsePositiveInt(args.count),
    })
    print(page, {
      markdown: value => renderTweetListMarkdown(value.tweets, {
        title: '首页关注时间线',
        notes: paginationNotes(value),
      }),
    })
  },
})

export const tweetHomeStream = defineCommand({
  meta: { name: 'home-stream', description: '流式遍历首页「最新微博」关注时间线（max_id 游标 + 自动去重）' },
  args: {
    'max-id': { type: 'string', description: '起始游标（上一页 maxId；缺省第一页）' },
    'since-id': { type: 'string', description: '增量过滤：只取比该微博 id 更新的条目（只请求一页）' },
    'list-id': { type: 'string', description: '关注分组 id（可选）' },
    'fid': { type: 'string', description: '分组过滤参数（可选）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamRangeArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const tweet of createSDK(args).tweets.streamFriendTimeline({
      maxId: args['max-id'],
      sinceId: args['since-id'],
      listId: args['list-id'],
      fid: args.fid,
      maxPages: parsePositiveInt(args['max-pages']),
      ...streamRangeFromArgs(args),
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, tweet }))
    }
    console.log(JSON.stringify({ event: 'done', count }))
  },
})

export const tweetLongtext = defineCommand({
  meta: { name: 'longtext', description: '获取长微博全文' },
  args: {
    id: { type: 'positional', description: '微博 mblogId', required: true },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const raw = await createSDK(args).tweets.longText(args.id)
    print(raw, {
      markdown: value => cleanTweetText(value.text) || '（长文为空）',
    })
  },
})

export const tweetReposts = defineCommand({
  meta: { name: 'reposts', description: '获取微博转发列表' },
  args: {
    id: { type: 'positional', description: '微博 mblogId', required: true },
    page: { type: 'string', description: '分页（可选）' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const raw = await createSDK(args).tweets.getReposts(args.id, {
      page: args.page ? Number(args.page) : undefined,
    })
    print(raw, {
      markdown: value => renderTweetListMarkdown(value.reposts, {
        title: '转发列表',
        notes: [
          ...(value.total !== undefined ? [`总数：${formatCount(value.total)}`] : []),
          ...(value.maxPage !== undefined ? [`总页数：${value.maxPage}`] : []),
        ],
      }),
    })
  },
})

export const tweetLikers = defineCommand({
  meta: { name: 'likers', description: '获取微博点赞者（按页；入参为数字 mid）' },
  args: {
    id: { type: 'positional', description: '微博数字 mid（不是字母 mblogid）', required: true },
    page: { type: 'string', description: '页码（可选，从 1 开始）' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const result = await createSDK(args).tweets.likers(args.id, {
      page: parsePositiveInt(args.page),
    })
    print(result, {
      markdown: value => renderLikerListMarkdown(value.likers, {
        title: '点赞者',
        notes: paginationNotes(value),
      }),
    })
  },
})

export const tweetLikersStream = defineCommand({
  meta: { name: 'likers-stream', description: '流式遍历微博点赞者（自动翻页 + 去重）' },
  args: {
    'id': { type: 'positional', description: '微博数字 mid（不是字母 mblogid）', required: true },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamLimitArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const liker of createSDK(args).tweets.streamLikers(args.id, {
      page: parsePositiveInt(args.page),
      maxPages: parsePositiveInt(args['max-pages']),
      maxItems: streamRangeFromArgs(args).maxItems,
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, liker }))
    }
    console.log(JSON.stringify({ event: 'done', mblogId: args.id, count }))
  },
})

export const tweetSearchProfile = defineCommand({
  meta: { name: 'search-profile', description: '按日期范围搜索用户微博' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    page: { type: 'string', description: '分页（可选）' },
    q: { type: 'string', description: '关键词（可选，个人主页内搜索）' },
    starttime: { type: 'string', description: '开始时间：YYYY-MM-DD / YYYYMMDD 或 unix 秒（可选，含当天起点）' },
    endtime: { type: 'string', description: '结束时间：YYYY-MM-DD / YYYYMMDD 或 unix 秒（可选，含当天终点）' },
    hasori: { type: 'string', description: '是否仅原创：0/1（可选）' },
    hasret: { type: 'string', description: '是否含转发：0/1（可选）' },
    hastext: { type: 'string', description: '是否含文本：0/1（可选）' },
    haspic: { type: 'string', description: '是否含图：0/1（可选）' },
    hasvideo: { type: 'string', description: '是否含视频：0/1（可选）' },
    hasmusic: { type: 'string', description: '是否含音乐：0/1（可选）' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const raw = await createSDK(args).tweets.searchByDate(args.id, {
      page: args.page ? Number(args.page) : undefined,
      q: args.q,
      starttime: args.starttime as string | undefined,
      endtime: args.endtime as string | undefined,
      hasori: args.hasori ? Number(args.hasori) : undefined,
      hasret: args.hasret ? Number(args.hasret) : undefined,
      hastext: args.hastext ? Number(args.hastext) : undefined,
      haspic: args.haspic ? Number(args.haspic) : undefined,
      hasvideo: args.hasvideo ? Number(args.hasvideo) : undefined,
      hasmusic: args.hasmusic ? Number(args.hasmusic) : undefined,
    })
    print(raw, {
      markdown: value => renderTweetListMarkdown(value.tweets, {
        title: '微博搜索结果',
        notes: value.total === undefined ? [] : [`总计：${value.total}`],
      }),
    })
  },
})
