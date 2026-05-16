#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')
const RAW_DIR = join(ROOT, 'tests', 'fixtures', 'raw')
const CAPTURE_DIR = join(RAW_DIR, 'captures')

// ── Parse HTTP/2 capture ────────────────────────────────────────

function parseRequest(text) {
  const t = text.replace(/\r\n/g, '\n')
  const firstLine = t.split('\n')[0].trim()
  const m = firstLine.match(/^(GET|POST) (\/[^ ]+) h2$/)
  if (!m)
    return null
  return { method: m[1], path: m[2] }
}

function parseResponse(text) {
  const t = text.replace(/\r\n/g, '\n')
  const parts = t.split('\n\n')
  if (parts.length < 2)
    return null
  try {
    return JSON.parse(parts.slice(1).join('\n\n'))
  }
  catch {
    return null
  }
}

// ── Sanitization (same rules as sanitize-fixtures.mjs) ───────────

const URL_RE = /^https?:\/\//
const INT_RE = /^\d{10,}$/
const DATE_RE = /^\w{3} \w{3} \d{2} \d{2}:\d{2}:\d{2}/

function sanitizeValue(v) {
  if (v === null || v === undefined)
    return v
  const t = typeof v
  if (t === 'boolean')
    return v
  if (t === 'number')
    return v > 1e15 ? -1 : (Number.isFinite(v) ? v : null)
  if (Array.isArray(v)) {
    if (v.length === 0)
      return []
    return v.map(sanitizeValue)
  }
  if (t === 'object') {
    const out = {}
    for (const [k, val] of Object.entries(v)) out[k] = sanitizeValue(val)
    return out
  }
  if (v === '')
    return ''
  if (URL_RE.test(v))
    return '<URL>'
  if (INT_RE.test(v))
    return '<ID>'
  if (DATE_RE.test(v))
    return '<DATE>'
  if (v.length <= 40)
    return v
  return '<TEXT>'
}

// ── Naming ───────────────────────────────────────────────────────

function deriveFilename(path, _data) {
  // /ajax/friendships/friends?page=1&uid=7679065628
  if (path.includes('/friendships/friends')) {
    const uid = path.match(/uid=(\d+)/)?.[1]
    return uid ? `friendships_followings_u${uid}` : 'friendships_followings'
  }

  // /ajax/profile/followContent?page=2&next_cursor=50
  if (path.includes('/followContent')) {
    const page = path.match(/page=(\d+)/)?.[1]
    return page ? `followContent_p${page}` : 'followContent'
  }

  // /ajax/favorites/all_fav?uid=7679065628&page=1&with_total=true
  if (path.includes('/favorites/all_fav')) {
    const page = path.match(/page=(\d+)/)?.[1]
    return page ? `favorites_p${page}` : 'favorites'
  }
  if (path.includes('/favorites/tags'))
    return 'favorites_tags'

  // /ajax/statuses/searchProfile
  if (path.includes('/searchProfile')) {
    const page = path.match(/page=(\d+)/)?.[1]
    return `searchProfile_p${page || '1'}`
  }

  // /ajax/profile/sidedetail
  if (path.includes('/sidedetail')) {
    const uid = path.match(/uid=(\d+)/)?.[1]
    return uid ? `sidedetail_u${uid}` : 'sidedetail'
  }

  // /ajax/side/cards/sideUser
  if (path.includes('/sideUser')) {
    const id = path.match(/id=(\w+)/)?.[1]
    return id ? `sideUser_${id}` : 'sideUser'
  }

  // /ajax/user/popcard
  if (path.includes('/popcard')) {
    const name = path.match(/screen_name=([^&]+)/)?.[1]
    const dec = name ? decodeURIComponent(name) : 'id'
    return `popcard_${dec.slice(0, 20)}`
  }

  // /ajax/profile/getFocusPic
  if (path.includes('/getFocusPic')) {
    const uid = path.match(/uid=(\d+)/)?.[1]
    return uid ? `focusPic_u${uid}` : 'focusPic'
  }

  // /ajax/side/cards/sideInterested
  if (path.includes('/sideInterested'))
    return 'sideInterested'

  // /ajax/side/cards (tweet detail)
  if (path.includes('/side/cards'))
    return `sideCards_${path.match(/id=(\w+)/)?.[1] || 'x'}`

  // /ajax/profile/tablist
  if (path.includes('/tablist'))
    return 'profile_tablist'

  // /ajax/profile/getSwitch
  if (path.includes('/getSwitch'))
    return 'profile_getSwitch'

  // /ajax/statuses/checkReward
  if (path.includes('/checkReward'))
    return 'check_reward2'

  // /ajax/statuses/checkAllowCommentWithPic
  if (path.includes('/checkAllowCommentWithPic'))
    return 'check_allow_comment_pic'

  // Already covered by prior fixtures — skip
  if (path.includes('/profile/info'))
    return null
  if (path.includes('/profile/detail'))
    return null
  if (path.includes('/statuses/mymblog'))
    return null
  if (path.includes('/statuses/show'))
    return null
  if (path.includes('/buildComments'))
    return null
  if (path.includes('/bandUnified'))
    return null
  if (path.includes('/log/action'))
    return null // analytics noise

  return null
}

// ── Description ──────────────────────────────────────────────────

function describe(name, data) {
  if (name.startsWith('friendships_followings'))
    return `关注列表 (${data.users?.length || '?'}个)`
  if (name.startsWith('followContent'))
    return `我的关注 (${data.data?.follows?.users?.length || data.follows?.users?.length || '?'}个)`
  if (name.startsWith('favorites_p'))
    return `收藏夹 (${data.data?.status?.length || data.status?.length || '?'}条)`
  if (name.startsWith('favorites_tags'))
    return '收藏夹标签'
  if (name.startsWith('searchProfile'))
    return `按日期搜索微博 (${data.data?.list?.length || data.list?.length || '?'}条)`
  if (name.startsWith('sidedetail'))
    return '用户侧边详情'
  if (name.startsWith('sideUser'))
    return '侧边用户卡片'
  if (name.startsWith('popcard'))
    return '用户弹窗卡片'
  if (name.startsWith('focusPic'))
    return '焦点图'
  if (name.startsWith('sideInterested'))
    return '侧边推荐'
  if (name.startsWith('sideCards'))
    return '微博侧边卡片'
  if (name.startsWith('profile_tablist'))
    return '个人页标签'
  if (name.startsWith('profile_getSwitch'))
    return '设置开关'
  if (name.startsWith('check_reward'))
    return '奖励检查'
  if (name.startsWith('check_allow_comment'))
    return '评论图片权限'
  return '-'
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('Processing captures...\n')

  const entries = await readdir(CAPTURE_DIR, { withFileTypes: true })
  const pairs = new Map()
  for (const e of entries) {
    if (!e.isFile())
      continue
    const m = e.name.match(/^\[(\d+)\] (request|response)_weibo\.com_message\.txt$/)
    if (!m)
      continue
    const id = m[1]
    const type = m[2]
    if (!pairs.has(id))
      pairs.set(id, {})
    pairs.get(id)[type] = join(CAPTURE_DIR, e.name)
  }

  const results = []
  const usedNames = new Set()

  for (const [id, { request: reqPath, response: resPath }] of pairs) {
    if (!reqPath || !resPath)
      continue

    const reqText = await readFile(reqPath, 'utf8')
    const resText = await readFile(resPath, 'utf8')

    const req = parseRequest(reqText)
    const data = parseResponse(resText)
    if (!req || !data)
      continue

    const name = deriveFilename(req.path, data)
    if (!name)
      continue

    // Deduplicate: keep largest response
    const raw = JSON.stringify(data)
    const existing = results.find(r => r.name === name)
    if (existing) {
      if (raw.length > existing.raw.length) {
        existing.raw = raw
        existing.data = data
        existing.source = id
        existing.path = req.path
      }
      continue
    }

    results.push({ name, data, raw, source: id, path: req.path })
  }

  // Write sanitized fixtures & build INDEX
  console.log('Writing fixtures...\n')
  const indexLines = []
  let totalO = 0
  let totalN = 0

  for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) {
    const sanitized = sanitizeValue(r.data)
    const newJson = JSON.stringify(sanitized)
    let fname = r.name
    let n = 2
    while (usedNames.has(fname)) fname = `${r.name}_v${n++}`
    usedNames.add(fname)

    const fp = join(RAW_DIR, `${fname}.json`)
    await writeFile(fp, newJson)

    const oSize = r.raw.length
    const nSize = newJson.length
    const pct = ((1 - nSize / oSize) * 100).toFixed(0)
    const desc = describe(r.name, r.data)

    console.log(`  ${fname}.json  ${(oSize / 1024).toFixed(0)}K → ${(nSize / 1024).toFixed(0)}K (${pct}%)  ← #${r.source} ${r.path}`)
    indexLines.push({ name: fname, size: nSize, pct, desc, path: r.path })
    totalO += oSize
    totalN += nSize
  }

  // Generate INDEX
  console.log('')
  console.log('Generating INDEX.md supplement...')
  let idx = '# 新增 Capture 索引\n\n'
  idx += '> 抓包来源：浏览器 DevTools HTTP/2 captures\n'
  idx += `> 生成：${new Date().toISOString().split('T')[0]} | ${indexLines.length} 文件\n\n`
  idx += '| 文件 | 大小 | 压缩率 | 内容 | 端点 |\n|------|------|--------|------|------|\n'

  for (const r of indexLines.sort((a, b) => a.name.localeCompare(b.name))) {
    idx += `| \`${r.name}.json\` | ${(r.size / 1024).toFixed(0)}K | ${r.pct}% | ${r.desc} | \`${r.path}\` |\n`
  }

  idx += `\n> 总计：${indexLines.length} 文件，${(totalO / 1024).toFixed(0)}K → ${(totalN / 1024).toFixed(0)}K（${((1 - totalN / totalO) * 100).toFixed(0)}% 节省）`

  await writeFile(join(RAW_DIR, 'CAPTURE_INDEX.md'), idx)

  console.log(`\nDone. ${(totalO / 1024).toFixed(0)}K → ${(totalN / 1024).toFixed(0)}K (${((1 - totalN / totalO) * 100).toFixed(0)}% saved)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
