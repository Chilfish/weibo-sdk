// 通用 fixture 脱敏工具：递归处理 JSON，对齐 tests/fixtures/raw/INDEX.md 的脱敏风格
// 用法：node scripts/sanitize-raw.mjs <input.json> <output.json>
// 规则：URL → <URL> | 长数字ID → <ID> | 日期 → <DATE> | 长文本(>40) → <TEXT>
import { readFileSync, writeFileSync } from 'node:fs'

const DATE_RE = /\d{4}-\d{2}-\d{2}/
const LONG_ID_RE = /^\d{12,}$/

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
        else if (lk === 'created_at' || lk.includes('date') || lk.includes('time'))
          out[k] = '<DATE>'
        else if (lk === 'idstr' || lk === 'mid' || lk === 'uid')
          out[k] = '<ID>'
        else out[k] = sanitizeString(v)
      }
      else if (typeof v === 'number' && lk === 'id' && v >= 1e12) {
        out[k] = -1 // 长 ID number → -1（避免真实 ID 泄漏，与既有 fixture 一致）
      }
      else {
        out[k] = sanitize(v, k)
      }
    }
    return out
  }
  return node
}

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('用法: node scripts/sanitize-raw.mjs <input.json> <output.json>')
  process.exit(1)
}
const data = JSON.parse(readFileSync(input, 'utf8'))
const result = sanitize(data)
writeFileSync(output, JSON.stringify(result))
console.log(`sanitized ${input} -> ${output}`)
