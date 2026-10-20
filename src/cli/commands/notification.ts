import { defineCommand } from 'citty'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK } from '../shared'

export const notificationComments = defineCommand({
  meta: { name: 'comments', description: '获取评论通知（别人评论我 / 回复我）' },
  args: {
    'max-id': { type: 'string', description: '游标（上一页返回的 cursor；与 --page 等价）' },
    'page': { type: 'string', description: '页码（可选，从 1 开始；未给 --max-id 时生效）' },
    ...cookieArg,
  },
  async run({ args }) {
    const result = await createSDK(args).notifications.listComments({
      maxId: parsePositiveInt(args['max-id']),
      page: parsePositiveInt(args.page),
    })
    console.log(JSON.stringify(result, null, 2))
  },
})

export const notificationCommentsStream = defineCommand({
  meta: { name: 'comments-stream', description: '流式遍历评论通知（游标自动翻页）' },
  args: {
    'max-id': { type: 'string', description: '起始游标（可选；缺省从第一页开始）' },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const notification of createSDK(args).notifications.streamComments({
      maxId: parsePositiveInt(args['max-id']),
      page: parsePositiveInt(args.page),
      maxPages: parsePositiveInt(args['max-pages']),
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, notification }))
    }
    console.log(JSON.stringify({ event: 'done', count }))
  },
})

export const notificationLikes = defineCommand({
  meta: { name: 'likes', description: '获取点赞通知（别人赞我）' },
  args: {
    'max-id': { type: 'string', description: '游标（上一页返回的 cursor；与 --page 等价）' },
    'page': { type: 'string', description: '页码（可选，从 1 开始；未给 --max-id 时生效）' },
    ...cookieArg,
  },
  async run({ args }) {
    const result = await createSDK(args).notifications.listLikes({
      maxId: parsePositiveInt(args['max-id']),
      page: parsePositiveInt(args.page),
    })
    console.log(JSON.stringify(result, null, 2))
  },
})

export const notificationLikesStream = defineCommand({
  meta: { name: 'likes-stream', description: '流式遍历点赞通知（游标自动翻页）' },
  args: {
    'max-id': { type: 'string', description: '起始游标（可选；缺省从第一页开始）' },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const notification of createSDK(args).notifications.streamLikes({
      maxId: parsePositiveInt(args['max-id']),
      page: parsePositiveInt(args.page),
      maxPages: parsePositiveInt(args['max-pages']),
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, notification }))
    }
    console.log(JSON.stringify({ event: 'done', count }))
  },
})
