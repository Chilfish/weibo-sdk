import { writeFileSync } from 'node:fs'
// scripts/spike-fix-explore.mjs
// 用「用户浏览器确切请求」验证 friendstimeline + 抓 buildComments fixture。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const rootPath = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(rootPath, '..', '.env'), override: true, quiet: true })
const cookie = process.env.WEIBO_COOKIE || ''
const xsrf = cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] || ''

// 用户浏览器完整头
const H = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,ja;q=0.6',
  'cache-control': 'no-cache',
  'client-version': 'v1.1.238',
  'pragma': 'no-cache',
  'priority': 'u=1, i',
  'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'server-version': 'v2026.08.07.1',
  'x-requested-with': 'XMLHttpRequest',
  'x-xsrf-token': xsrf,
  'cookie': cookie,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Referer': 'https://weibo.com/mygroups?gid=110007679065628',
}

async function req(label, url, saveTo) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15_000) })
  const text = await r.text()
  let j = null
  try {
    j = JSON.parse(text)
  }
  catch { /* html */ }
  if (saveTo && j)
    writeFileSync(saveTo, JSON.stringify(j, null, 2))
  const head = j
    ? `ok:${j.ok} | statuses:${j.statuses?.length ?? 'n/a'} | msg:${j.message ?? j.tip_msg ?? ''}`
    : `HTTP ${r.status} HTML[${text.slice(0, 40).replace(/\s+/g, ' ')}]`
  console.log(`[${label}] HTTP ${r.status} => ${head}`)
}

console.log('=== friendstimeline 用户确切请求 ===')
await req('F 用户分组 feed', 'https://weibo.com/ajax/feed/friendstimeline?list_id=110007679065628&refresh=4&since_id=0&count=25&fid=110007679065628')

console.log('\n=== buildComments 全参数 ===')
await req('C buildComments', 'https://weibo.com/ajax/statuses/buildComments?is_reload=1&id=5330092595085886&is_show_bulletin=2&is_mix=0&count=20&type=feed&uid=7679065628&fetch_level=0&locale=en-US', 'tests/fixtures/raw/comments_feed.json')
