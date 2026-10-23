import type { Dirent } from 'node:fs'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '..')
const ENTRY = path.join(ROOT, 'src/index.ts')
const CONFIG_PATH = path.join(ROOT, 'api-surface.json')
const SNAPSHOT_PATH = path.join(ROOT, 'api-surface.snapshot.json')
const DOCS_ROOT = path.join(ROOT, 'website')
/** 生成页：列出全部导出，不能作为「有说明」的证据。 */
const GENERATED_DOC_PAGES = new Set(['api/types/index.md'])

/**
 * Stable 保留模式：这些后缀是「形状会随 minor 演进的辅助类型」。
 *
 * 它们默认只能待在 experimental；确需升 Stable 时必须显式登记在
 * `api-surface.json` 的 `allowStablePatternExceptions`，否则门禁失败——
 * 避免 Stable 层靠「顺手加一行」悄悄长回来（见 docs/engineering/api-stability.md §6）。
 */
const STABLE_RESERVED_PATTERN = /(?:Options|Progress|ProgressSummary|ProgressEvent|LoggerOptions|LogWriteStream)$/

interface ApiSurfaceConfig {
  schemaVersion: number
  tiers: {
    stable: string[]
    experimental: string[]
  }
  /** 允许以 Stable 身份命中 `STABLE_RESERVED_PATTERN` 的显式豁免；默认空。 */
  allowStablePatternExceptions?: string[]
  serviceDocs: Record<string, string[]>
}

interface ExportInfo {
  name: string
  kind: string
  file: string
}

const KIND_NAMES: Array<[ts.SymbolFlags, string]> = [
  [ts.SymbolFlags.Class, 'class'],
  [ts.SymbolFlags.Interface, 'interface'],
  [ts.SymbolFlags.TypeAlias, 'type'],
  [ts.SymbolFlags.Function, 'function'],
  [ts.SymbolFlags.Enum, 'enum'],
  [ts.SymbolFlags.Variable, 'const'],
  [ts.SymbolFlags.ValueModule, 'namespace'],
]

function kindOf(checker: ts.TypeChecker, symbol: ts.Symbol): string {
  const resolved = (symbol.getFlags() & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol
  const flags = resolved.getFlags()
  for (const [flag, name] of KIND_NAMES) {
    if (flags & flag)
      return name
  }
  return 'other'
}

function loadProgram(): { program: ts.Program, checker: ts.TypeChecker } {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json')
  if (!configPath)
    throw new Error('tsconfig.json not found')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT)
  const program = ts.createProgram([ENTRY], parsed.options)
  return { program, checker: program.getTypeChecker() }
}

function collectExports(): ExportInfo[] {
  const { program, checker } = loadProgram()
  const source = program.getSourceFile(ENTRY)
  if (!source)
    throw new Error(`entry not found: ${ENTRY}`)

  const moduleSymbol = checker.getSymbolAtLocation(source)
  if (!moduleSymbol)
    throw new Error('entry module symbol not found')

  return checker.getExportsOfModule(moduleSymbol)
    .map((symbol) => {
      const declaration = symbol.declarations?.[0]
      const file = declaration
        ? path.relative(ROOT, declaration.getSourceFile().fileName).replaceAll('\\', '/')
        : ''
      return { name: symbol.getName(), kind: kindOf(checker, symbol), file }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function listMode(exports: ExportInfo[]): void {
  const groups = new Map<string, ExportInfo[]>()
  for (const item of exports) {
    const group = item.file.replace(/^src\//, '').split('/').slice(0, -1).join('/') || '(root)'
    const list = groups.get(group) ?? []
    list.push(item)
    groups.set(group, list)
  }

  for (const [group, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`\n## ${group} (${items.length})`)
    for (const item of items)
      console.log(`${item.name}\t${item.kind}`)
  }
  console.log(`\nTOTAL ${exports.length}`)
}

function readConfig(): ApiSurfaceConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ApiSurfaceConfig
}

function readSnapshot(): { schemaVersion: number, exports: Array<{ name: string, kind: string }> } | undefined {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  }
  catch {
    return undefined
  }
}

function listMarkdownFiles(dir: string): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  }
  catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory())
      out.push(...listMarkdownFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.md'))
      out.push(full)
  }
  return out
}

function publicMembers(file: string, className: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const names: string[] = []

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== className)
      continue

    for (const member of statement.members) {
      if (!member.name || !ts.isIdentifier(member.name))
        continue
      if (ts.isConstructorDeclaration(member))
        continue
      const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : []
      if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword || modifier.kind === ts.SyntaxKind.StaticKeyword))
        continue

      const jsDoc = ts.getJSDocCommentsAndTags(member)
      const internal = jsDoc.some((doc) => {
        if (!ts.isJSDoc(doc))
          return false
        return doc.tags?.some(tag => tag.tagName.text === 'internal') ?? false
      })
      if (internal)
        continue

      names.push(member.name.text)
    }
  }

  return names
}

function findServiceFiles(): Map<string, string> {
  const dir = path.join(ROOT, 'src/services/public')
  const out = new Map<string, string>()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts'))
      continue
    const file = path.join(dir, entry.name)
    const text = readFileSync(file, 'utf8')
    const match = text.match(/export class (\w+)/)
    if (match)
      out.set(match[1], file)
  }
  out.set('WeiboSDK', path.join(ROOT, 'src/WeiboSDK.ts'))
  return out
}

/**
 * 文档覆盖判定：名称必须出现在代码片段中（行内 code 或 fenced block）。
 *
 * 散文里顺带提一句不算「有说明」；`api/types/index.md` 是生成页，会列出全部导出，
 * 因此不参与覆盖判定。
 */
function hasDocumentedName(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const inline = new RegExp(`\`[^\`\\n]*${escaped}[^\`\\n]*\``)
  if (inline.test(text))
    return true
  for (const block of text.matchAll(/```[\s\S]*?```/g)) {
    if (new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(block[0]))
      return true
  }
  return false
}

function writeExportIndex(exports: ExportInfo[]): void {
  const sections: string[] = [
    '---',
    'title: 导出索引',
    'outline: deep',
    '---',
    '',
    '# 导出索引',
    '',
    `包根共导出 ${exports.length} 个名称。本页由 \`pnpm check:api --write\` 生成；类型字段与签名以包内 \`.d.mts\` 为准。`,
    '',
    '| 名称 | 种类 |',
    '|---|---|',
  ]

  for (const item of exports)
    sections.push(`| \`${item.name}\` | ${item.kind} |`)
  sections.push('')

  const target = path.join(DOCS_ROOT, 'types/index.md')
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, `${sections.join('\n')}\n`)
  console.log(`export index written: ${path.relative(ROOT, target)}`)
}

function main(): void {
  const args = new Set(process.argv.slice(2))
  const exports = collectExports()

  if (args.has('--list')) {
    listMode(exports)
    return
  }

  if (args.has('--seed-config')) {
    const config = readConfig()
    const experimental = new Set(config.tiers.experimental)
    const stable = exports
      .map(item => item.name)
      .filter(name => !experimental.has(name))
      .sort()
    const next: ApiSurfaceConfig = {
      schemaVersion: 1,
      tiers: { stable, experimental: [...experimental].sort() },
      allowStablePatternExceptions: [...(config.allowStablePatternExceptions ?? [])].sort(),
      serviceDocs: config.serviceDocs,
    }
    writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`api-surface.json seeded: ${stable.length} stable / ${experimental.size} experimental`)
    return
  }

  const config = readConfig()
  const failures: string[] = []

  const classified = new Map<string, 'stable' | 'experimental'>()
  for (const tier of ['stable', 'experimental'] as const) {
    for (const name of config.tiers[tier]) {
      const previous = classified.get(name)
      if (previous)
        failures.push(`"${name}" 同时出现在 ${previous} 与 ${tier}`)
      classified.set(name, tier)
    }
  }

  const exportNames = new Set(exports.map(item => item.name))
  for (const [name, tier] of classified) {
    if (!exportNames.has(name))
      failures.push(`api-surface.json 的 ${tier} 条目 "${name}" 已不是包根导出（请移除）`)
  }
  for (const item of exports) {
    if (!classified.has(item.name))
      failures.push(`新增导出 "${item.name}" (${item.kind}, ${item.file}) 未在 api-surface.json 分层`)
  }

  // Stable 保留模式：*Options / *Progress* / logger 选项 / LogWriteStream 只能 experimental。
  const stableExceptions = new Set(config.allowStablePatternExceptions ?? [])
  for (const name of config.tiers.stable) {
    if (STABLE_RESERVED_PATTERN.test(name) && !stableExceptions.has(name)) {
      failures.push(
        `[stable] "${name}" 命中 Stable 保留模式（*Options / *Progress* / *LoggerOptions / LogWriteStream）：0.x 内这类形状只能待在 experimental；`
        + '确需 Stable 请加入 api-surface.json 的 allowStablePatternExceptions，并在 docs/engineering/api-stability.md §6 写明理由',
      )
    }
  }
  for (const name of stableExceptions) {
    if (!config.tiers.stable.includes(name))
      failures.push(`allowStablePatternExceptions 中的 "${name}" 不是 stable 条目（豁免只能用于已升 Stable 的名字，请移除）`)
  }

  const docsFiles = listMarkdownFiles(DOCS_ROOT)
    .filter(file => !GENERATED_DOC_PAGES.has(path.relative(DOCS_ROOT, file).replaceAll('\\', '/'))
      && !file.includes(`${path.sep}node_modules${path.sep}`)
      && !file.includes(`${path.sep}.vitepress${path.sep}`))
  const docsText = docsFiles.map(file => readFileSync(file, 'utf8')).join('\n')
  for (const [name, tier] of classified) {
    if (tier !== 'stable')
      continue
    if (!hasDocumentedName(docsText, name))
      failures.push(`[${tier}] "${name}" 未在 website/** 的代码片段中说明`)
  }

  const serviceFiles = findServiceFiles()
  for (const [className, pages] of Object.entries(config.serviceDocs)) {
    const file = serviceFiles.get(className)
    if (!file) {
      failures.push(`serviceDocs 引用的 ${className} 不存在`)
      continue
    }
    const pageText = pages
      .map(page => path.join(ROOT, page))
      .filter((page) => {
        try {
          readFileSync(page)
          return true
        }
        catch {
          failures.push(`serviceDocs 页面不存在：${path.relative(ROOT, page).replaceAll('\\', '/')}`)
          return false
        }
      })
      .map(page => readFileSync(page, 'utf8'))
      .join('\n')

    for (const method of publicMembers(file, className)) {
      if (!hasDocumentedName(pageText, `${method}`))
        failures.push(`${className}.${method}() 未在 ${pages.join(' / ')} 的代码片段中说明`)
    }
  }

  const snapshot = {
    schemaVersion: 1,
    exports: exports.map(({ name, kind }) => ({ name, kind })),
  }

  if (args.has('--write')) {
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)
    writeExportIndex(exports)
    console.log(`snapshot written: ${path.relative(ROOT, SNAPSHOT_PATH)} (${exports.length} exports)`)
  }
  else {
    const previous = readSnapshot()
    if (!previous) {
      failures.push('缺少 api-surface.snapshot.json；先运行 `pnpm check:api --write`')
    }
    else {
      const before = new Map(previous.exports.map(item => [item.name, item.kind]))
      const after = new Map(snapshot.exports.map(item => [item.name, item.kind]))
      for (const [name, kind] of after) {
        if (!before.has(name))
          failures.push(`导出面新增：${name} (${kind})`)
        else if (before.get(name) !== kind)
          failures.push(`导出面 kind 变化：${name} ${before.get(name)} → ${kind}`)
      }
      for (const [name] of before) {
        if (!after.has(name))
          failures.push(`导出面移除：${name}`)
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\nAPI surface check failed (${failures.length}):\n`)
    for (const failure of failures)
      console.error(`- ${failure}`)
    console.error('\n提示：新增/移除导出时同步更新 api-surface.json、api-surface.snapshot.json 与 website/api/**。')
    process.exitCode = 1
    return
  }

  console.log(`API surface OK: ${exports.length} exports, ${docsFiles.length} docs pages.`)
}

main()
