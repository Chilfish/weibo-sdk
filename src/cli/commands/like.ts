import { defineCommand } from 'citty'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK, streamLimitArg, streamRangeFromArgs } from '../shared'

export const likeList = defineCommand({
  meta: { name: 'list', description: '获取我赞过的微博（按页遍历）' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    page: { type: 'string', description: '页码（可选，从 1 开始）' },
    ...cookieArg,
  },
  async run({ args }) {
    const result = await createSDK(args).likes.listByUserId(args.id, {
      page: parsePositiveInt(args.page),
    })
    console.log(JSON.stringify(result, null, 2))
  },
})

export const likeStream = defineCommand({
  meta: { name: 'stream', description: '流式遍历我赞过的微博（自动翻页 + 跨页去重）' },
  args: {
    'id': { type: 'positional', description: '用户 UID', required: true },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamLimitArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const tweet of createSDK(args).likes.streamByUserId(args.id, {
      page: parsePositiveInt(args.page),
      maxPages: parsePositiveInt(args['max-pages']),
      maxItems: streamRangeFromArgs(args).maxItems,
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, tweet }))
    }
    console.log(JSON.stringify({ event: 'done', uid: args.id, count }))
  },
})
