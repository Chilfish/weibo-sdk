#!/usr/bin/env node
import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')
const RAW_DIR = join(ROOT, 'tests', 'fixtures', 'raw')
const CAPTURE_DIR = join(RAW_DIR, 'weibo-capture')

// ── Sanitization ─────────────────────────────────────────────────
// 规则（按优先级）：
//   typeof v
//   ├─ number    → keep (compact); >1e15 → -1
//   ├─ boolean   → keep
//   ├─ string    → '' → ''
//   │             → URL-like → <URL>
//   │             → pure int > 10 digits → <ID>
//   │             → date format → <DATE>
//   │             → else → <TEXT>
//   ├─ null      → null
//   ├─ array     → recurse
//   └─ object    → recurse

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
    for (const [k, val] of Object.entries(v))
      out[k] = sanitizeValue(val)
    return out
  }

  // string
  if (v === '')
    return ''
  if (URL_RE.test(v))
    return '<URL>'
  if (INT_RE.test(v))
    return '<ID>'
  if (DATE_RE.test(v))
    return '<DATE>'
  // Short strings likely IDs/tags — keep as-is to preserve lookups (pic_ids, etc.)
  if (v.length <= 40)
    return v
  return '<TEXT>'
}

// ── Naming ───────────────────────────────────────────────────────

function deriveFilename(data, src) {
  const s = src.toLowerCase()
  if (s.includes('search_users'))
    return `search_users_p${(s.match(/page(\d+)/) || ['', '1'])[1]}`
  if (s.includes('bandunified') || (s.includes('hot') && !s.includes('check')))
    return 'hot_trends'
  if (s.includes('sidedetail'))
    return 'profile_sidedetail'
  if (s.includes('buildcomments'))
    return 'comments'
  if (s.includes('friendstimeline'))
    return 'feed_home'
  if (s.includes('mymblog') || s.includes('timeline')) {
    const uid = data.data?.list?.[0]?.user?.idstr || data.data?.list?.[0]?.user?.id
    return uid ? `timeline_u${uid}` : 'timeline'
  }
  if (s.includes('profile_info') || (s.includes('info') && !s.includes('check') && !s.includes('sidedetail'))) {
    const u = data.data?.user || data.user
    return u ? `profile_info_u${u.idstr || u.id || 'x'}` : 'profile_info'
  }
  if (s.includes('profile_detail') || (s.includes('detail') && !s.includes('side')))
    return 'profile_detail'
  if (s.includes('statuses_show') || s.includes('status_show') || s.includes('_show'))
    return `tweet_${data.mblogid || 'x'}`
  if (s.includes('checkreward'))
    return 'check_reward'
  if (s.includes('statuses_config') || s.includes('_config'))
    return 'statuses_config'
  if (s.includes('feed_allgroups') || s.includes('allgroups'))
    return 'feed_groups'
  if (s.includes('side_cards'))
    return 'side_cards'
  if (data.data?.realtime)
    return 'hot_trends'
  if (data.filter_group && Array.isArray(data.data))
    return 'comments'
  if (data.statuses)
    return 'feed_home'
  if (data.data?.list)
    return 'timeline'
  if (data.data?.user)
    return 'profile_info'
  if (data.data?.created_at !== undefined)
    return 'profile_detail'
  if (data.idstr && data.mblogid)
    return `tweet_${data.mblogid}`
  if (data.data?.tabs)
    return 'feed_groups'
  return 'fixture'
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('Sanitizing fixtures...\n')
  await mkdir(RAW_DIR, { recursive: true })

  const pending = []

  for (const dir of [RAW_DIR, CAPTURE_DIR]) {
    try {
      for (const f of await readdir(dir, { withFileTypes: true })) {
        if (f.isFile() && f.name.endsWith('.json'))
          pending.push({ fp: join(dir, f.name), source: f.name })
      }
    }
    catch {}
  }

  const results = []
  const usedNames = new Set()

  for (const { fp, source } of pending) {
    const raw = await readFile(fp, 'utf8')
    let data
    try {
      data = JSON.parse(raw)
    }
    catch {
      continue
    }

    const sanitized = sanitizeValue(data)
    let name = deriveFilename(data, source)
    let n = 2
    while (usedNames.has(name)) name = `${deriveFilename(data, source)}_v${n++}`
    usedNames.add(name)

    const newJson = JSON.stringify(sanitized)
    await writeFile(join(RAW_DIR, `${name}.json`), newJson)
    const pct = ((1 - newJson.length / raw.length) * 100).toFixed(0)
    console.log(`  ${name}.json  ${(raw.length / 1024).toFixed(0)}K → ${(newJson.length / 1024).toFixed(0)}K (${pct}%)  ← ${source}`)
    results.push({ name, source, origSize: raw.length, newSize: newJson.length, data: sanitized })
    await unlink(fp)
  }

  // Clean up empty capture dir
  try {
    await rmdir(CAPTURE_DIR)
  }
  catch {}

  // INDEX.md
  console.log('\nGenerating INDEX.md...')
  let idx = '# Fixture 索引\n\n'
  idx += '> 数据已脱敏：URL → `<URL>` | 长数字ID → `<ID>` | 日期 → `<DATE>` | 其他字符串 → `<TEXT>`\n'
  idx += `> 生成：${new Date().toISOString().split('T')[0]} | ${results.length} 文件\n\n`
  idx += '| 文件 | 大小 | 压缩率 | 内容 |\n|------|------|--------|------|\n'

  for (const r of results) {
    const d = r.data
    let desc = ''
    if (d.data?.realtime)
      desc = `热搜 (${d.data.realtime.length}条)`
    else if (d.filter_group)
      desc = `评论 (${d.data?.length || 0}条)`
    else if (d.statuses)
      desc = `Feed (${d.statuses.length}条)`
    else if (d.data?.list)
      desc = `时间线 (${d.data.list.length}条)`
    else if (d.data?.cards)
      desc = `搜索 (${d.data.cards.length}cards)`
    else if (d.data?.user)
      desc = '用户信息'
    else if (d.data?.created_at !== undefined)
      desc = '用户详情'
    else if (d.idstr && d.mblogid)
      desc = '微博详情'
    else desc = '-'
    const pct = ((1 - r.newSize / r.origSize) * 100).toFixed(0)
    idx += `| \`${r.name}.json\` | ${(r.newSize / 1024).toFixed(0)}K | ${pct}% | ${desc} |\n`
  }

  await writeFile(join(RAW_DIR, 'INDEX.md'), idx)

  const totalO = results.reduce((s, r) => s + r.origSize, 0)
  const totalN = results.reduce((s, r) => s + r.newSize, 0)
  console.log(`\nDone. ${(totalO / 1024).toFixed(0)}K → ${(totalN / 1024).toFixed(0)}K (${((1 - totalN / totalO) * 100).toFixed(0)}% saved)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
