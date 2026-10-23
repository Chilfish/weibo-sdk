import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const WEBSITE = path.join(ROOT, 'website')

const FORBIDDEN: Array<{ pattern: RegExp, reason: string }> = [
  { pattern: /[A-Za-z]:\\dev\\/, reason: '本机路径' },
  { pattern: /\]\((?!https?:\/\/)[^)]*docs\/(?:engineering|planning|postmortem|development-log|archive)\//, reason: '指向内部文档的相对链接' },
  { pattern: /\]\((?!https?:\/\/)[^)]*\.agents\//, reason: '指向仓库内部 Agent 文档的相对链接' },
  { pattern: /\]\((?:\.\.\/)+AGENTS\.md/, reason: '指向内部 AGENTS.md 的相对链接' },
]

function markdownFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.vitepress' || entry.name === 'public')
      continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory())
      out.push(...markdownFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.md'))
      out.push(full)
  }
  return out
}

const failures = []

for (const file of markdownFiles(WEBSITE)) {
  const text = readFileSync(file, 'utf8')
  const relative = path.relative(ROOT, file).replaceAll('\\', '/')

  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(text))
      failures.push(`${relative}: 出现${rule.reason}（${rule.pattern}）`)
  }
}

if (failures.length > 0) {
  console.error(`公开文档检查失败（${failures.length}）：\n`)
  for (const failure of failures)
    console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`公开文档检查通过：${markdownFiles(WEBSITE).length} 个页面，未发现内部引用。`)
