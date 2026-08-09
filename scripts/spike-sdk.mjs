// scripts/spike-sdk.mjs
// Spike：真实网络调用，验证 weibo-sdk 各 Service 的能力边界与归一化质量。
// 用法：node scripts/spike-sdk.mjs
//   - 依赖 .env 中的 WEIBO_COOKIE
//   - 输出结构化摘要（pick 出领域模型关键字段，不做 raw dump）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { WeiboSDK } from '../dist/index.mjs'

const rootPath = path.dirname(fileURLToPath(import.meta.url))
config({
  path: path.join(rootPath, '..', '.env'),
  override: true,
  quiet: true,
})
const cookie = process.env.WEIBO_COOKIE || ''
if (!cookie) {
  console.error('缺少 WEIBO_COOKIE（检查 .env）')
  process.exit(1)
}

const sdk = new WeiboSDK({ cookie })
const results = []
let selfUid
let probeSeq = 0

function withTimeout(p, ms = 15_000) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ])
}

async function probe(title, fn) {
  const start = Date.now()
  probeSeq += 1
  try {
    const data = await withTimeout(fn())
    results.push({ seq: probeSeq, title, ok: true, ms: Date.now() - start, data })
  }
  catch (e) {
    const ctx = e?.context
    results.push({
      seq: probeSeq,
      title,
      ok: false,
      ms: Date.now() - start,
      error: e?.message ?? String(e),
      detail: ctx
        ? { code: e?.code, apiOk: ctx.ok, apiMsg: ctx.message, httpStatus: ctx.status }
        : undefined,
    })
  }
}

// ---- pick 函数：把领域模型实例压成可读摘要 ----
function pickUser(u) {
  return u && ({
    id: u.id,
    name: u.name,
    url: u.url,
    location: u.location,
    gender: u.gender,
    createdAt: u.createdAt,
    verification: u.verification,
    stats: u.stats,
    creditLevel: u.creditLevel,
    company: u.company,
    school: u.school,
    birthday: u.birthday,
    realName: u.realName,
    externalLinks: u.externalLinks?.slice(0, 2),
  })
}

function pickTweet(t) {
  return t && ({
    id: t.id,
    mblogId: t.mblogId,
    createdAt: t.createdAt,
    text: (t.text || '').slice(0, 70),
    source: t.source,
    regionName: t.regionName,
    user: t.user,
    stats: t.stats,
    visible: t.visible,
    media: t.media?.map(m => ({
      type: m.type,
      url: (m.imageUrl || '').slice(0, 72),
      video: m.videoUrl ? '(mp4)' : undefined,
      size: m.width && m.height ? `${m.width}x${m.height}` : undefined,
    })),
    pageInfo: t.pageInfo ? { title: t.pageInfo.pageTitle, url: (t.pageInfo.pageUrl || '').slice(0, 72) } : undefined,
    geo: t.geo,
    retweeted: t.retweetedStatus
      ? { mblogId: t.retweetedStatus.mblogId, user: t.retweetedStatus.user?.name, text: (t.retweetedStatus.text || '').slice(0, 50) }
      : undefined,
  })
}

const summarize = {
  userList: list => ({
    count: list.length,
    users: list.slice(0, 3).map(pickUser),
  }),
  tweetList: list => ({
    count: list.length,
    tweets: list.slice(0, 3).map(pickTweet),
  }),
}

// ============================================================
// 1. 会话 / 身份
// ============================================================
await probe('01 session / whoami', async () => {
  const ok = await sdk.checkSession()
  if (!ok)
    throw new Error('Cookie 无效或会话过期')

  const details = await sdk.users.myDetails()
  const verifiedUrl = details.data.verified_url || ''
  const uid = verifiedUrl.match(/uid=(\d+)/)?.[1]
  selfUid = uid
  return { ok, uid, ipLocation: details.data.ip_location, createdAt: details.data.created_at }
})

// ============================================================
// 2. 用户（info + details → User 领域模型）
// ============================================================
await probe('02 user.getById 归一化', async () => {
  const user = await sdk.users.getById(selfUid)
  return pickUser(user)
})

// ============================================================
// 3. 微博详情（show + longtext → Tweet 领域模型）
// ============================================================
let firstMblogId
await probe('03 user 时间线第一页', async () => {
  const page = await sdk.tweets.listByUserId(selfUid, { count: 8 })
  firstMblogId = page.tweets[0]?.mblogId
  return { sinceId: page.sinceId, hasMore: page.hasMore, ...summarize.tweetList(page.tweets) }
})

await probe('04 tweet.getByMblogId 归一化', async () => {
  const tweet = await sdk.tweets.getByMblogId(firstMblogId, true)
  return pickTweet(tweet)
})

await probe('05 tweet.longText 长微博全文', async () => {
  const raw = await sdk.tweets.longText(firstMblogId)
  const text = raw.data?.longTextContent || raw.data?.text || ''
  return { mblogId: firstMblogId, textLength: text.length, preview: text.slice(0, 60) }
})

await probe('06 tweet.comments 评论', async () => {
  const raw = await sdk.tweets.comments(firstMblogId, { count: 5 })
  return { total: raw.total_number, count: raw.data?.length }
})

await probe('07 tweet.getReposts 转发', async () => {
  const raw = await sdk.tweets.getReposts(firstMblogId, { page: 1 })
  return { total: raw.total_number, count: raw.data?.length, reposters: raw.data?.slice(0, 3).map(r => r.user?.screen_name) }
})

// ============================================================
// 4. 时间线 / Feed
// ============================================================
await probe('08 tweet.listFriendTimeline 首页 Feed', async () => {
  const page = await sdk.tweets.listFriendTimeline({ count: 5 })
  return { count: page.tweets.length, hasMore: page.hasMore, first: page.tweets[0] && pickTweet(page.tweets[0]) }
})

await probe('09 tweet.streamByUserId 流式（取前 6 条）', async () => {
  const tweets = []
  for await (const t of sdk.tweets.streamByUserId(selfUid, { count: 5 })) {
    tweets.push(t)
    if (tweets.length >= 6)
      break
  }
  return { pulled: tweets.length, uniqueUsers: new Set(tweets.map(t => t.user.name)).size }
})

await probe('10 tweet.searchByDate 按日期搜', async () => {
  const raw = await sdk.tweets.searchByDate(selfUid, { page: 1 })
  return { total: raw.data?.list?.length ?? raw.data?.statuses?.length, sample: (raw.data?.list?.[0] || raw.data?.statuses?.[0])?.mblogid }
})

// ============================================================
// 5. 关注 / 粉丝 / 收藏
// ============================================================
await probe('11 follow.getFollowings', async () => {
  const raw = await sdk.followings.getFollowings(selfUid, 1)
  return { total: raw.total_number, count: raw.users?.length, users: raw.users?.slice(0, 3).map(u => u.screen_name) }
})

await probe('12 follow.getFans', async () => {
  const raw = await sdk.followings.getFans(selfUid, 1)
  return { total: raw.total_number, count: raw.users?.length }
})

await probe('13 favorite.getTags', async () => {
  const raw = await sdk.favorites.getTags()
  return { count: raw.tags?.length, tags: raw.tags?.slice(0, 5) }
})

await probe('14 favorite.getFavorites', async () => {
  const raw = await sdk.favorites.getFavorites(selfUid, 1)
  return { total: raw.data?.total_number, count: raw.data?.status?.length }
})

// ============================================================
// 6. 搜索 / 热搜
// ============================================================
await probe('15 search.searchUsers', async () => {
  const raw = await sdk.search.searchUsers('前端开发', 1)
  const cards = raw.data?.cards || []
  const users = cards.flatMap(c => c.card_group || [])
  return { query: '前端开发', count: users.length, users: users.slice(0, 3).map(u => u.user?.screen_name) }
})

await probe('16 search.searchTweets', async () => {
  const raw = await sdk.search.searchTweets('TypeScript', 1)
  const cards = raw.data?.cards || []
  const tweets = cards.flatMap(c => c.card_group || [])
  return { query: 'TypeScript', count: tweets.length, sample: tweets.slice(0, 3).map(t => t.mblog?.mblogid) }
})

await probe('17 trends.hotBand 热搜榜', async () => {
  const raw = await sdk.trends.hotBand('hot')
  const band = raw.data?.realtime || []
  return { count: band.length, top: band.slice(0, 5).map((b, i) => ({ rank: i + 1, word: b.word, hot: b.num })) }
})

// ============================================================
// 7. archive 归档流（timeline 阶段，限 1 页，关闭 reposts/favorites）
// ============================================================
await probe('18 archive.streamArchive', async () => {
  const items = []
  for await (const item of sdk.archive.streamArchive(selfUid, {
    includeReposts: false,
    includeFavorites: false,
    maxPagesPerPhase: 1,
    count: 5,
  })) {
    items.push({ source: item.source, mblogId: item.mblogId, digest: typeof item.schemaDigest })
    if (items.length >= 5)
      break
  }
  return { items }
})

// ============================================================
// 输出
// ============================================================
console.log('\n==================== Weibo SDK Spike 结果 ====================')
for (const r of results) {
  const status = r.ok ? '✅' : '❌'
  const time = `${r.ms}ms`
  const body = r.ok ? JSON.stringify(r.data, null, 2) : `   ${r.error}${r.detail ? `\n   ${JSON.stringify(r.detail)}` : ''}`
  console.log(`\n${status} [#${String(r.seq).padStart(2, '0')}] ${r.title}  (${time})`)
  console.log(body)
}
console.log('\n==================== 能力矩阵 ====================')
for (const r of results)
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.title}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n总计 ${results.length} 项，通过 ${results.length - failed}，失败 ${failed}`)
