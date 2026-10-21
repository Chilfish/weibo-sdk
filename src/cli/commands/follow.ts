import { defineCommand } from 'citty'
import { paginationNotes } from '~/models/view/format'
import { renderFollowingUserListMarkdown } from '~/models/view/UserList'
import { createPrinter, outputFormatArg } from '../output'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK, streamLimitArg } from '../shared'

/** 去重后合并特别关注与普通关注（同一用户可能同时出现在两处）。 */
function uniqueUsers<T extends { id?: string | number, idstr?: string }>(users: readonly T[]): T[] {
  const seen = new Set<string>()
  return users.filter((user) => {
    const key = String(user.idstr ?? user.id ?? '')
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

function streamOptions(args: Record<string, unknown>): { page?: number, maxPages?: number, maxItems?: number } {
  return {
    page: parsePositiveInt(args.page),
    maxPages: parsePositiveInt(args['max-pages']),
    maxItems: parsePositiveInt(args['max-items']),
  }
}

function printProgress(progress: unknown): void {
  console.log(JSON.stringify({ event: 'progress', ...(progress as Record<string, unknown>) }))
}

export const followStream = defineCommand({
  meta: { name: 'stream', description: '流式遍历用户关注列表（page 游标 + 自动去重）' },
  args: {
    'id': { type: 'positional', description: '用户 UID', required: true },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamLimitArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const user of createSDK(args).followings.streamFollowings(args.id, {
      ...streamOptions(args),
      onProgress: printProgress,
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, user }))
    }
    console.log(JSON.stringify({ event: 'done', uid: args.id, count }))
  },
})

export const followFansStream = defineCommand({
  meta: { name: 'fans-stream', description: '流式遍历用户粉丝列表（page 游标 + 自动去重）' },
  args: {
    'id': { type: 'positional', description: '用户 UID', required: true },
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamLimitArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const user of createSDK(args).followings.streamFans(args.id, {
      ...streamOptions(args),
      onProgress: printProgress,
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, user }))
    }
    console.log(JSON.stringify({ event: 'done', uid: args.id, count }))
  },
})

export const followMyStream = defineCommand({
  meta: { name: 'my-stream', description: '流式遍历自己的关注列表（page 游标 + 自动去重）' },
  args: {
    'page': { type: 'string', description: '起始页码（可选，从 1 开始）' },
    'max-pages': { type: 'string', description: '最多翻页数（可选，默认不限）' },
    ...streamLimitArg,
    ...cookieArg,
  },
  async run({ args }) {
    let count = 0
    for await (const user of createSDK(args).followings.streamMyFollowings({
      ...streamOptions(args),
      onProgress: printProgress,
    })) {
      count += 1
      console.log(JSON.stringify({ event: 'item', count, user }))
    }
    console.log(JSON.stringify({ event: 'done', count }))
  },
})

export const followList = defineCommand({
  meta: { name: 'list', description: '获取用户关注列表（cursor 分页）' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    page: { type: 'string', description: '分页（可选）' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const raw = await createSDK(args).followings.getFollowings(
      args.id,
      args.page ? Number(args.page) : undefined,
    )
    print(raw, {
      markdown: value => renderFollowingUserListMarkdown(value.users, {
        title: '关注列表',
        notes: paginationNotes({ cursor: value.next_cursor, total: value.total_number }),
      }),
    })
  },
})

export const followFans = defineCommand({
  meta: { name: 'fans', description: '获取用户粉丝列表（cursor 分页）' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    page: { type: 'string', description: '分页（可选）' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const raw = await createSDK(args).followings.getFans(
      args.id,
      args.page ? Number(args.page) : undefined,
    )
    print(raw, {
      markdown: value => renderFollowingUserListMarkdown(value.users, {
        title: '粉丝列表',
        notes: paginationNotes({ cursor: value.next_cursor, total: value.total_number }),
      }),
    })
  },
})

export const followMy = defineCommand({
  meta: { name: 'my', description: '获取自己的关注列表（cursor 分页）' },
  args: {
    page: { type: 'string', description: '分页（可选）' },
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const print = createPrinter(args)
    const raw = await createSDK(args).followings.getMyFollowings(
      args.page ? Number(args.page) : undefined,
    )
    print(raw, {
      markdown: (value) => {
        const attention = value.data.specialAttention?.users ?? []
        const users = uniqueUsers([...attention, ...value.data.follows.users])
        return renderFollowingUserListMarkdown(users, {
          title: '我的关注',
          notes: [
            ...(attention.length > 0 ? [`特别关注：${attention.length} 人（排在最前）`] : []),
            ...paginationNotes({
              cursor: value.data.follows.next_cursor,
              total: value.data.total_number ?? value.data.follows.total_number,
            }),
          ],
        })
      },
    })
  },
})
