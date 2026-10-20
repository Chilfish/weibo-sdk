// 通用 fixture 脱敏工具：递归处理 JSON，对齐 tests/fixtures/raw/INDEX.md 的脱敏风格
// 用法：node scripts/sanitize-raw.mjs <input.json> <output.json> [--keep-ids]
// 规则：URL → <URL> | 长数字ID → <ID> | 日期 → <DATE> | 长文本(>40) → <TEXT>
// --keep-ids：保留 mid / idstr / uid / 数字 id。移动端微博没有 mblogid，mid 是唯一关联键；
//            关注/粉丝列表也依赖 idstr 去重（见 postmortem 006「脱敏保留关联」）。
import { readFileSync, writeFileSync } from 'node:fs'

const DATE_RE = /\d{4}-\d{2}-\d{2}/
const LONG_ID_RE = /^\d{12,}$/
const keepIds = process.argv.includes('--keep-ids')

function sanitizeString(value) {
  if (/^(?:https?:|\/\/)/.test(value))
    return '<URL>'
  if (DATE_RE.test(value) || /^\w{3} \w{3} \d{1,2}/.test(value))
    return '<DATE>'
  if (LONG_ID_RE.test(value))
    return '<ID>'
  if (value.length > 40)
    return '<TEXT>'
  return value
}

function sanitize(node, parentKey) {
  if (Array.isArray(node))
    return node.map(v => sanitize(v, parentKey))
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      const lk = k.toLowerCase()
      if (typeof v === 'string') {
        if (lk.includes('url'))
          out[k] = '<URL>'
        else if (lk === 'since_id' || lk === 'next_cursor' || lk === 'previous_cursor')
          out[k] = v // 分页游标保留真实值（与既有 fixture 惯例一致）
        else if (lk === 'timeline_month' || lk === 'timeline_year')
          out[k] = v // 图片墙的时间粒度（YYYY / MM），不是完整日期
        else if (lk === 'created_at' || lk.includes('date') || lk.includes('time'))
          out[k] = '<DATE>'
        else if (lk === 'idstr' || lk === 'mid' || lk === 'uid')
          out[k] = keepIds ? v : '<ID>'
        else out[k] = sanitizeString(v)
      }
      else if (typeof v === 'number' && lk === 'id' && v >= 1e12) {
        out[k] = keepIds ? v : -1 // 长 ID number → -1（避免真实 ID 泄漏，与既有 fixture 一致）
      }
      else {
        out[k] = sanitize(v, k)
      }
    }
    return out
  }
  return node
}

const [input, output] = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
if (!input || !output) {
  console.error('用法: node scripts/sanitize-raw.mjs <input.json> <output.json> [--keep-ids]')
  process.exit(1)
}
const data = JSON.parse(readFileSync(input, 'utf8'))
const result = sanitize(data)
writeFileSync(output, JSON.stringify(result))
console.log(`sanitized ${input} -> ${output}`)
