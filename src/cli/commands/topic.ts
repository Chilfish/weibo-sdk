import { defineCommand } from 'citty'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK } from '../shared'

export const topicCates = defineCommand({
  meta: { name: 'cates', description: '获取超话分类（sort_id 来源）' },
  args: { ...cookieArg },
  async run({ args }) {
    const categories = await createSDK(args).topics.cates()
    console.log(JSON.stringify(categories, null, 2))
  },
})

export const topicList = defineCommand({
  meta: { name: 'list', description: '获取一页超话列表 / 关键词搜索' },
  args: {
    'sort-id': { type: 'string', description: '分类 id（来自 topic cates）' },
    'keyword': { type: 'string', description: '关键词（非空时按关键词搜索）' },
    'page': { type: 'string', description: '页码（可选，从 1 开始）' },
    ...cookieArg,
  },
  async run({ args }) {
    const result = await createSDK(args).topics.list({
      sortId: parsePositiveInt(args['sort-id']),
      keyword: args.keyword,
      page: parsePositiveInt(args.page),
    })
    console.log(JSON.stringify(result, null, 2))
  },
})

export const topicStream = defineCommand({
  meta: { name: 'stream', description: '流式遍历超话列表 / 搜索结果（page 游标 + 去重）' },
  args: {
    'sort-id': { type: 'string', description: '分类 id（来自 topic cates）' },
    'keyword': { type: 'string', description: '关键词（非空时按关键词搜索）' },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const topic of createSDK(args).topics.stream({
      sortId: parsePositiveInt(args['sort-id']),
      keyword: args.keyword,
      page: parsePositiveInt(args.page),
      maxPages: parsePositiveInt(args['max-pages']),
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, topic }))
    }
    console.log(JSON.stringify({ event: 'done', count }))
  },
})
