import { defineCommand } from 'citty'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK, streamRangeArg, streamRangeFromArgs } from '../shared'

export const userInfo = defineCommand({
  meta: { name: 'info', description: '获取用户信息' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    ...cookieArg,
  },
  async run({ args }) {
    const user = await createSDK(args).users.getById(args.id)
    console.log(JSON.stringify(user, null, 2))
  },
})

export const userTimeline = defineCommand({
  meta: { name: 'timeline', description: '获取用户微博时间线' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    page: { type: 'string', description: '页码（从 1 开始）', alias: 'p' },
    count: { type: 'string', description: '每页条数' },
    ...cookieArg,
  },
  async run({ args }) {
    const page = await createSDK(args).tweets.listByUserId(args.id, {
      page: args.page ? Number(args.page) : undefined,
      count: args.count ? Number(args.count) : undefined,
    })
    console.log(JSON.stringify(page, null, 2))
  },
})

export const userTimelineStream = defineCommand({
  meta: { name: 'timeline-stream', description: '流式遍历用户微博时间线（page 游标 + 跨页去重）' },
  args: {
    'id': { type: 'positional', description: '用户 UID', required: true },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'count': { type: 'string', description: '每页条数（可选，缺省由上游决定）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamRangeArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const tweet of createSDK(args).tweets.streamByUserId(args.id, {
      page: parsePositiveInt(args.page),
      count: parsePositiveInt(args.count),
      maxPages: parsePositiveInt(args['max-pages']),
      ...streamRangeFromArgs(args),
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, tweet }))
    }
    console.log(JSON.stringify({ event: 'done', uid: args.id, count }))
  },
})

export const userMentions = defineCommand({
  meta: { name: 'mentions', description: '获取 @我的微博（按页）' },
  args: {
    'max-id': { type: 'string', description: '游标（上一页返回的 cursor；与 --page 等价）' },
    'page': { type: 'string', description: '页码（可选，从 1 开始；未给 --max-id 时生效）' },
    ...cookieArg,
  },
  async run({ args }) {
    const result = await createSDK(args).users.listMentions({
      maxId: parsePositiveInt(args['max-id']),
      page: parsePositiveInt(args.page),
    })
    console.log(JSON.stringify(result, null, 2))
  },
})

export const userMentionsStream = defineCommand({
  meta: { name: 'mentions-stream', description: '流式遍历 @我的微博（游标自动翻页）' },
  args: {
    'max-id': { type: 'string', description: '起始游标（可选；缺省从第一页开始）' },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamRangeArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const tweet of createSDK(args).users.streamMentions({
      maxId: parsePositiveInt(args['max-id']),
      page: parsePositiveInt(args.page),
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

export const userGroups = defineCommand({
  meta: { name: 'groups', description: '获取关注分组（feed/allGroups）' },
  args: { ...cookieArg },
  async run({ args }) {
    const groups = await createSDK(args).users.groups()
    console.log(JSON.stringify(groups, null, 2))
  },
})

export const userMblogGroups = defineCommand({
  meta: { name: 'mblog-groups', description: '获取微博分组（mblog/querygroup）' },
  args: { ...cookieArg },
  async run({ args }) {
    const groups = await createSDK(args).users.mblogGroups()
    console.log(JSON.stringify(groups, null, 2))
  },
})
