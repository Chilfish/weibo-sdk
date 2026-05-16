import { defineCommand } from 'citty'
import { cookieArg, createSDK } from '../shared'

export const tweetDetail = defineCommand({
  meta: { name: 'detail', description: '获取微博详情' },
  args: { id: { type: 'positional', description: '微博 mblogId', required: true }, ...cookieArg },
  async run({ args }) {
    const tweet = await createSDK(args).tweets.getByMblogId(args.id)
    console.log(JSON.stringify(tweet, null, 2))
  },
})

export const tweetComments = defineCommand({
  meta: { name: 'comments', description: '获取微博评论' },
  args: {
    id: { type: 'positional', description: '微博 mblogId', required: true },
    count: { type: 'string', description: '每页条数' },
    flow: { type: 'string', description: '排序：0=热度 1=时间' },
    ...cookieArg,
  },
  async run({ args }) {
    const raw = await createSDK(args).tweets.comments(args.id, {
      count: args.count ? Number(args.count) : undefined,
      flow: args.flow ? (Number(args.flow) as 0 | 1) : undefined,
    })
    console.log(JSON.stringify(raw, null, 2))
  },
})

export const tweetTimeline = defineCommand({
  meta: { name: 'home', description: '获取首页 Feed（关注时间线）' },
  args: {
    since_id: { type: 'string', description: '分页游标', alias: 's' },
    count: { type: 'string', description: '每页条数' },
    ...cookieArg,
  },
  async run({ args }) {
    const page = await createSDK(args).tweets.listFriendTimeline({
      since_id: args.since_id ? Number(args.since_id) : undefined,
      count: args.count ? Number(args.count) : undefined,
    })
    console.log(JSON.stringify(page, null, 2))
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

export const tweetSearchProfile = defineCommand({
  meta: { name: 'search-profile', description: '按日期范围搜索用户微博' },
  args: {
    id: { type: 'positional', description: '用户 UID', required: true },
    page: { type: 'string', description: '分页（可选）' },
    starttime: { type: 'string', description: '开始时间（可选）' },
    endtime: { type: 'string', description: '结束时间（可选）' },
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
