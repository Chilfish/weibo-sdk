import { defineCommand } from 'citty'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK } from '../shared'

export const tweetDetail = defineCommand({
  meta: { name: 'detail', description: '获取微博详情' },
  args: { id: { type: 'positional', description: '微博 mblogId', required: true }, ...cookieArg },
  async run({ args }) {
    const tweet = await createSDK(args).tweets.getByMblogId(args.id)
    console.log(JSON.stringify(tweet, null, 2))
  },
})

export const tweetEnrich = defineCommand({
  meta: { name: 'enrich', description: '补拉微博原始响应 + 归一化模型（可选长微博全文）' },
  args: {
    'id': { type: 'positional', description: '微博 mblogId', required: true },
    'longtext': { type: 'boolean', description: '额外补拉长微博全文' },
    'no-longtext': { type: 'boolean', description: 'statuses/show 不请求长微博全文' },
    ...cookieArg,
  },
  async run({ args }) {
    const result = await createSDK(args).tweets.enrich(args.id, {
      includeLongText: args.longtext,
      isGetLongText: !args['no-longtext'],
    })
    console.log(JSON.stringify(result, null, 2))
  },
})

export const tweetComments = defineCommand({
  meta: { name: 'comments', description: '获取微博评论' },
  args: {
    'id': { type: 'positional', description: '微博 mblogId', required: true },
    'max-id': { type: 'string', description: '分页游标（上一页响应顶层的 max_id；可选）' },
    'count': { type: 'string', description: '每页条数（上游忽略，固定 20）' },
    'flow': { type: 'string', description: '排序：0=热度 1=时间（时间序需数字 mid，SDK 自动解析）' },
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).tweets.comments(args.id, {
      max_id: parsePositiveInt(args['max-id']),
      count: args.count ? Number(args.count) : undefined,
      flow: args.flow ? (Number(args.flow) as 0 | 1) : undefined,
    })
    console.log(JSON.stringify(raw, null, 2))
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
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const comment of createSDK(args).tweets.streamComments(args.id, {
      maxId: parsePositiveInt(args['max-id']),
      count: parsePositiveInt(args.count),
      flow: args.flow ? (Number(args.flow) as 0 | 1) : undefined,
      maxPages: parsePositiveInt(args['max-pages']),
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
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const repost of createSDK(args).tweets.streamReposts(args.id, {
      page: parsePositiveInt(args.page),
      count: parsePositiveInt(args.count),
      maxPages: parsePositiveInt(args['max-pages']),
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
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).tweets.replies(args.id, args['root-id'], {
      max_id: parsePositiveInt(args['max-id']),
      count: parsePositiveInt(args.count),
      flow: args.flow ? (Number(args.flow) as 0 | 1) : undefined,
    })
    console.log(JSON.stringify(raw, null, 2))
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
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const comment of createSDK(args).tweets.streamReplies(args.id, args['root-id'], {
      maxId: parsePositiveInt(args['max-id']),
      count: parsePositiveInt(args.count),
      flow: args.flow ? (Number(args.flow) as 0 | 1) : undefined,
      maxPages: parsePositiveInt(args['max-pages']),
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
    ...cookieArg,
  },
  async run({ args }) {
    const page = await createSDK(args).tweets.listFriendTimeline({
      max_id: args['max-id'],
      since_id: args['since-id'],
      list_id: args['list-id'],
      fid: args.fid,
      refresh: args.refresh ? Number(args.refresh) : undefined,
      count: parsePositiveInt(args.count),
    })
    console.log(JSON.stringify(page, null, 2))
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
  args: { id: { type: 'positional', description: '微博 mblogId', required: true }, ...cookieArg },
  async run({ args }) {
    const raw = await createSDK(args).tweets.longText(args.id)
    console.log(JSON.stringify(raw, null, 2))
  },
})

export const tweetReposts = defineCommand({
  meta: { name: 'reposts', description: '获取微博转发列表' },
  args: {
    id: { type: 'positional', description: '微博 mblogId', required: true },
    page: { type: 'string', description: '分页（可选）' },
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).tweets.getReposts(args.id, {
      page: args.page ? Number(args.page) : undefined,
    })
    console.log(JSON.stringify(raw, null, 2))
  },
})

export const tweetLikers = defineCommand({
  meta: { name: 'likers', description: '获取微博点赞者（按页；入参为数字 mid）' },
  args: {
    id: { type: 'positional', description: '微博数字 mid（不是字母 mblogid）', required: true },
    page: { type: 'string', description: '页码（可选，从 1 开始）' },
    ...cookieArg,
  },
  async run({ args }) {
    const result = await createSDK(args).tweets.likers(args.id, {
      page: parsePositiveInt(args.page),
    })
    console.log(JSON.stringify(result, null, 2))
  },
})

export const tweetLikersStream = defineCommand({
  meta: { name: 'likers-stream', description: '流式遍历微博点赞者（自动翻页 + 去重）' },
  args: {
    'id': { type: 'positional', description: '微博数字 mid（不是字母 mblogid）', required: true },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const liker of createSDK(args).tweets.streamLikers(args.id, {
      page: parsePositiveInt(args.page),
      maxPages: parsePositiveInt(args['max-pages']),
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
    ...cookieArg,
  },
  async run({ args }) {
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
    console.log(JSON.stringify(raw, null, 2))
  },
})
