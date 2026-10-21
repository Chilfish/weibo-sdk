import { defineCommand } from 'citty'
import { paginationNotes } from '~/models/view/format'
import { renderCommentListMarkdown } from '~/models/view/TweetList'
import { createPrinter, outputFormatArg } from '../output'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK, streamRangeArg, streamRangeFromArgs } from '../shared'

export const commentMine = defineCommand({
  meta: { name: 'mine', description: '获取当前登录用户的历史评论（按页）' },
  args: {
    'max-id': { type: 'string', description: '游标（上一页返回的 cursor；与 --page 等价）' },
    'page': { type: 'string', description: '页码（可选，从 1 开始；未给 --max-id 时生效）' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const result = await createSDK(args).commentHistory.listMine({
      maxId: parsePositiveInt(args['max-id']),
      page: parsePositiveInt(args.page),
    })
    print(result, {
      markdown: value => renderCommentListMarkdown(value.comments, {
        title: '历史评论',
        notes: paginationNotes(value),
      }),
    })
  },
})

export const commentStream = defineCommand({
  meta: { name: 'stream', description: '流式遍历当前登录用户的历史评论（游标自动翻页）' },
  args: {
    'max-id': { type: 'string', description: '起始游标（可选；缺省从第一页开始）' },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamRangeArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const comment of createSDK(args).commentHistory.streamMine({
      maxId: parsePositiveInt(args['max-id']),
      page: parsePositiveInt(args.page),
      maxPages: parsePositiveInt(args['max-pages']),
      ...streamRangeFromArgs(args),
      onProgress: (progress) => {
        console.log(JSON.stringify({ event: 'progress', ...progress }))
      },
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, comment }))
    }
    console.log(JSON.stringify({ event: 'done', count }))
  },
})
