import { defineCommand } from 'citty'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK, streamLimitArg, streamRangeFromArgs } from '../shared'

export const favoriteList = defineCommand({
  meta: { name: 'list', description: '获取收藏夹（按页遍历）' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    page: { type: 'string', description: '分页（可选，从 1 开始）' },
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).favorites.getFavorites(
      args.id,
      parsePositiveInt(args.page),
    )
    console.log(JSON.stringify(raw, null, 2))
  },
})

export const favoriteStream = defineCommand({
  meta: { name: 'stream', description: '流式遍历收藏夹（自动翻页 + 去重 + 标签过滤）' },
  args: {
    'id': { type: 'positional', description: '用户 UID', required: true },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'tag': { type: 'string', description: '只输出带指定标签的收藏（标签 id 或名称）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamLimitArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const tweet of createSDK(args).favorites.streamFavorites(args.id, {
      page: parsePositiveInt(args.page),
      tag: args.tag,
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

export const favoriteTags = defineCommand({
  meta: { name: 'tags', description: '获取收藏夹标签' },
  args: { ...cookieArg },
  async run({ args }) {
    const raw = await createSDK(args).favorites.getTags()
    console.log(JSON.stringify(raw, null, 2))
  },
})
