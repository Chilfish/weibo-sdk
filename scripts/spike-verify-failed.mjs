// scripts/spike-verify-failed.mjs
// 诊断 5 个失败端点：用「真实浏览器参数」验证根因（缺参数 vs schema/接口问题）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { WeiboSDK } from '../dist/index.mjs'

const rootPath = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(rootPath, '..', '.env'), override: true, quiet: true })
const cookie = process.env.WEIBO_COOKIE || ''
const sdk = new WeiboSDK({ cookie })

// 取 selfUid + 一条真实 mblogId
const me = await sdk.users.myDetails()
const uid = me.data.verified_url?.match(/uid=(\d+)/)?.[1]
const page = await sdk.tweets.listByUserId(uid, { count: 3 })
const mid = page.tweets[0]?.mblogId
console.log(`uid=${uid} mblogid=${mid}\n`)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
const xsrf = cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] || ''
// 用户浏览器完整请求头（含 x-xsrf-token）
const H = {
  'User-Agent': UA,
  'Referer': 'https://weibo.com/',
  'Cookie': cookie,
  'accept': 'application/json, text/plain, */*',
  'x-requested-with': 'XMLHttpRequest',
  'x-xsrf-token': xsrf,
  'priority': 'u=1, i',
}

async function show(label, url, headers = H) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
    const text = await r.text()
    let j = null
    try {
      j = JSON.parse(text)
    }
    catch { /* */ }
    const head = j
      ? `ok:${j.ok} | data 类型:${Array.isArray(j.data) ? 'array' : typeof j.data} | ${JSON.stringify(j).slice(0, 180)}`
      : `HTTP ${r.status} HTML[${text.slice(0, 50).replace(/\s+/g, ' ')}]`
    console.log(`[${label}] HTTP ${r.status} => ${head}`)
  }
  catch (e) {
    console.log(`[${label}] 异常: ${e?.message}`)
  }
}

console.log('--- 用真实浏览器参数 ---')
await show('06 comments  全参数', `https://weibo.com/ajax/statuses/buildComments?is_reload=1&id=${mid}&is_show_bulletin=2&is_mix=0&count=5&type=feed&uid=${uid}&fetch_level=0&locale=en-US`)
await show('08 friendTl  +refresh=4', `https://weibo.com/ajax/feed/friendstimeline?since_id=0&count=5&refresh=4`)
await show('14 all_fav   +with_total', `https://weibo.com/ajax/favorites/all_fav?uid=${uid}&page=1&with_total=true`)

console.log('\n--- 对照组：缺关键参数 ---')
await show('06b comments 缺type/uid', `https://weibo.com/ajax/statuses/buildComments?id=${mid}&count=5`)
await show('08b friendTl 缺refresh', `https://weibo.com/ajax/feed/friendstimeline?since_id=0&count=5`)
await show('14b all_fav  缺with_total', `https://weibo.com/ajax/favorites/all_fav?uid=${uid}&page=1`)

console.log('\n--- 搜索（验证是否真的失效）---')
await show('15 searchUsers', `https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D3&q=${encodeURIComponent('前端开发')}&page=1`)
await show('16 searchTwt', `https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D1&q=TypeScript&page=1`)
