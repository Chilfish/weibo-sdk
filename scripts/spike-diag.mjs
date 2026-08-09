// scripts/spike-diag.mjs
// 诊断 v3：用浏览器最新 cookie（BROWSER_COOKIE 环境变量）对比 .env cookie。
// 用法：PowerShell 里设 $env:BROWSER_COOKIE='...' 后运行
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const rootPath = path.dirname(fileURLToPath(import.meta.url))
config({
  path: path.join(rootPath, '..', '.env'),
  override: true,
  quiet: true,
})
const envCookie = process.env.WEIBO_COOKIE || ''
const browserCookie = process.env.BROWSER_COOKIE || ''

const UA_150 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
const browserHeaders = {
  'accept': 'application/json',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,ja;q=0.6',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
  'priority': 'u=1, i',
  'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'x-requested-with': 'XMLHttpRequest',
  'Referer': 'https://weibo.com/',
  'User-Agent': UA_150,
}
const sdkHeaders = { 'User-Agent': UA_150, 'Referer': 'https://weibo.com/' }

const band = 'https://weibo.com/ajax/side/bandUnified?type=hot'
const show = 'https://weibo.com/ajax/statuses/show?id=RcD47f9xS'

async function req(label, url, cookie, headers) {
  const merged = cookie ? { ...headers, Cookie: cookie } : headers
  try {
    const r = await fetch(url, { headers: merged, signal: AbortSignal.timeout(15_000) })
    const text = await r.text()
    let j = null
    try {
      j = JSON.parse(text)
    }
    catch { /* html */ }
    const tag = j
      ? `ok:${j.ok} msg:${j.msg} ${j.data?.band_list ? `band:${j.data.band_list.length}` : ''}`
      : `HTML[${text.slice(0, 36).replace(/\s+/g, ' ')}]`
    console.log(`[${label}] HTTP ${r.status} => ${tag}`)
  }
  catch (e) {
    console.log(`[${label}] 异常: ${e?.message}`)
  }
}

console.log(`BROWSER_COOKIE 提供: ${browserCookie ? `是(${browserCookie.length}字符)` : '否'}`)
console.log(`env SUB 一致: ${browserCookie && envCookie ? envCookie.match(/SUB=([^;]+)/)?.[1] === browserCookie.match(/SUB=([^;]+)/)?.[1] : 'n/a'}\n`)

await req('1 band  浏览器cookie+浏览器头 ', band, browserCookie, browserHeaders)
await req('2 band  env cookie+浏览器头    ', band, envCookie, browserHeaders)
await req('3 band  浏览器cookie+SDK头    ', band, browserCookie, sdkHeaders)
await req('4 band  浏览器cookie+SDK头+xhr ', band, browserCookie, { ...sdkHeaders, 'x-requested-with': 'XMLHttpRequest' })
await req('5 show  浏览器cookie+浏览器头 ', show, browserCookie, browserHeaders)
