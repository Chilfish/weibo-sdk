import { defineCommand } from 'citty'
import { parsePositiveInt } from '../parseArgs'
import { cookieArg, createSDK } from '../shared'

function streamOptions(args: Record<string, unknown>): { page?: number, maxPages?: number } {
  return {
    page: parsePositiveInt(args.page),
    maxPages: parsePositiveInt(args['max-pages']),
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
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).followings.getFollowings(
      args.id,
      args.page ? Number(args.page) : undefined,
    )
    console.log(JSON.stringify(raw, null, 2))
  },
})

export const followFans = defineCommand({
  meta: { name: 'fans', description: '获取用户粉丝列表（cursor 分页）' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    page: { type: 'string', description: '分页（可选）' },
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).followings.getFans(
      args.id,
      args.page ? Number(args.page) : undefined,
    )
    console.log(JSON.stringify(raw, null, 2))
  },
})

export const followMy = defineCommand({
  meta: { name: 'my', description: '获取自己的关注列表（cursor 分页）' },
  args: {
    page: { type: 'string', description: '分页（可选）' },
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).followings.getMyFollowings(
      args.page ? Number(args.page) : undefined,
    )
    console.log(JSON.stringify(raw, null, 2))
  },
})
