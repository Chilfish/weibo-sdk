import type { Dirent } from 'node:fs'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '..')
const ENTRY = path.join(ROOT, 'src/index.ts')
const CONFIG_PATH = path.join(ROOT, 'api-surface.json')
const SNAPSHOT_PATH = path.join(ROOT, 'api-surface.snapshot.json')
const DOCS_ROOT = path.join(ROOT, 'website')
const GENERATED_DOC_PAGES = new Set(['api/types/index.md'])

/**
 * Stable 保留模式：这些后缀是「形状会随 minor 演进的辅助类型」。
 *
 * 它们默认只能待在 evolving；确需升 Stable 时必须显式登记在
 * `api-surface.json` 的 `allowStablePatternExceptions`，否则门禁失败——
 * 避免 Stable 层靠「顺手加一行」悄悄长回来（见 docs/engineering/api-stability.md §6）。
 */
export const STABLE_RESERVED_PATTERN = /(?:Options|Progress|ProgressSummary|ProgressEvent|LoggerOptions|LogWriteStream)$/

export type ApiTier = 'stable' | 'evolving'
export type ApiShape = 'options' | 'progress' | 'runtime' | 'extension' | 'utility' | 'model'

/**
 * shape 只是文档分组维度，不是额外承诺：它从名字推导，用于告诉下游
 * 「这是一个选项类型 / 进度类型 / 运行时标签」，而不是「这是一个能力」。
 */
const SHAPE_RULES: Array<[ApiShape, RegExp]> = [
  ['options', /Options$/],
  ['progress', /Progress/],
  ['runtime', /^(?:Archive(?:Phase|ErrorAction|ErrorStage|TimelineSource|ItemErrorContext|RawMeta)|Capability|FollowingsSource|UserArchiveEvent|listCapabilities|WEIBO_CAPABILITIES)/],
  ['extension', /^(?:Credential|PluginRequestInfo|TransportFailure|LogWriteStream)/],
  ['utility', /^(?:build|format|normalize|parse|mid|diff|migrate|render|is)/],
]

const SHAPE_ORDER: ApiShape[] = ['options', 'progress', 'runtime', 'extension', 'utility', 'model']

const SHAPE_LABELS: Record<ApiShape, string> = {
  options: '选项类型（Options）',
  progress: '进度类型（Progress）',
  runtime: '运行时标签',
  extension: '扩展点形状（Credential / Plugin / Transport）',
  utility: '辅助函数',
  model: '模型与契约',
}

interface ApiSurfaceConfig {
  schemaVersion: number
  tiers: {
    stable: string[]
    evolving: string[]
  }
  /** 允许以 Stable 身份命中 `STABLE_RESERVED_PATTERN` 的显式豁免；默认空。 */
  allowStablePatternExceptions?: string[]
  /** 方法层级：未列出的公开方法默认 Stable；`fetchRaw*` 必须显式登记。 */
  methodTiers?: {
    evolving: string[]
  }
  serviceDocs: Record<string, string[]>
}

interface ExportInfo {
  name: string
  kind: string
  file: string
}

/** 公开方法（仅 MethodDeclaration），用于方法层级校验。 */
export interface PublicMethod {
  className: string
  name: string
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

export function shapeOf(name: string): ApiShape {
  for (const [shape, pattern] of SHAPE_RULES) {
    if (pattern.test(name))
      return shape
  }
  return 'model'
}

export function isStableReserved(name: string): boolean {
  return STABLE_RESERVED_PATTERN.test(name)
}

/**
 * 方法层级校验（纯函数）。
 *
 * - `fetchRaw*` 返回上游原始形状，必须显式登记为 evolving；
 * - 登记的名字必须仍对应一个公开方法，避免豁免/清单变成垃圾场。
 */
export function validateMethodTiers(methods: PublicMethod[], evolving: string[]): string[] {
  const failures: string[] = []
  const declared = new Set(evolving)
  const actual = new Set(methods.map(method => `${method.className}.${method.name}`))

  for (const key of declared) {
    if (!actual.has(key))
      failures.push(`methodTiers.evolving 中的 "${key}" 不是公开方法（请移除）`)
  }

  for (const method of methods) {
    const key = `${method.className}.${method.name}`
    if (method.name.startsWith('fetchRaw') && !declared.has(key))
      failures.push(`公开方法 ${key}() 返回上游原始形状，必须登记到 methodTiers.evolving`)
  }

  return failures
}

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

function classMembers(file: string, className: string, methodsOnly = false): string[] {
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
      if (methodsOnly && !ts.isMethodDeclaration(member))
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

function collectPublicMethods(serviceFiles: Map<string, string>): PublicMethod[] {
  const methods: PublicMethod[] = []
  for (const [className, file] of serviceFiles) {
    for (const name of classMembers(file, className, true))
      methods.push({ className, name })
  }
  return methods
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

function table(items: ExportInfo[]): string[] {
  return [
    '| 名称 | 种类 |',
    '|---|---|',
    ...items.map(item => `| \`${item.name}\` | ${item.kind} |`),
  ]
}

function writeExportIndex(exports: ExportInfo[], config: ApiSurfaceConfig): void {
  const classified = new Map<string, ApiTier>()
  for (const tier of ['stable', 'evolving'] as const) {
    for (const name of config.tiers[tier])
      classified.set(name, tier)
  }

  const stable = exports.filter(item => classified.get(item.name) === 'stable')
  const evolving = exports.filter(item => classified.get(item.name) === 'evolving')
  const unclassified = exports.filter(item => !classified.has(item.name))

  const counts = [`Stable ${stable.length}`, `Evolving ${evolving.length}`]
  if (unclassified.length > 0)
    counts.push(`未分层 ${unclassified.length}`)

  const sections: string[] = [
    '---',
    'title: 导出索引',
    'outline: deep',
    '---',
    '',
    '# 导出索引',
    '',
    `包根共导出 ${exports.length} 个名称：${counts.join(' / ')}。本页由 \`pnpm check:api --write\` 生成；类型字段与签名以包内 \`.d.mts\` 为准。`,
    '',
    'Stable 是下游可以依赖的契约；Evolving 可以调用，但形状可能随 minor 版本演进，不属于破坏性承诺。',
    '',
    `## Stable（${stable.length}）`,
    '',
    ...table(stable),
    '',
    `## Evolving（${evolving.length}）`,
    '',
    '按 shape 分组；shape 由名字推导，只用于说明「这是什么形状」，不构成额外承诺。',
  ]

  for (const shape of SHAPE_ORDER) {
    const items = evolving.filter(item => shapeOf(item.name) === shape)
    if (items.length === 0)
      continue
    sections.push('', `### ${SHAPE_LABELS[shape]}（${items.length}）`, '', ...table(items))
  }

  if (unclassified.length > 0) {
    sections.push(
      '',
      '## 未分层（需要在 `api-surface.json` 决定层级）',
      '',
      ...table(unclassified),
    )
  }
  sections.push('')

  const target = path.join(DOCS_ROOT, 'api/types/index.md')
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, `${sections.join('\n')}\n`)
  console.log(`export index written: ${path.relative(ROOT, target)}`)
}

function main(): void {
  const args = new Set(process.argv.slice(2))
  const exports = collectExports()
  const serviceFiles = findServiceFiles()

  if (args.has('--list')) {
    listMode(exports)
    return
  }

  if (args.has('--seed-config')) {
    const config = readConfig()
    const evolving = new Set(config.tiers.evolving ?? [])
    const stable = exports
      .map(item => item.name)
      .filter(name => !evolving.has(name))
      .sort()
    const evolvingMethods = collectPublicMethods(serviceFiles)
      .filter(method => method.name.startsWith('fetchRaw'))
      .map(method => `${method.className}.${method.name}`)
      .sort()
    const next: ApiSurfaceConfig = {
      schemaVersion: 2,
      tiers: { stable, evolving: [...evolving].sort() },
      allowStablePatternExceptions: [...(config.allowStablePatternExceptions ?? [])].sort(),
      methodTiers: { evolving: evolvingMethods },
      serviceDocs: config.serviceDocs,
    }
    writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`api-surface.json seeded: ${stable.length} stable / ${evolving.size} evolving / ${evolvingMethods.length} evolving methods`)
    return
  }

  const config = readConfig()
  const failures: string[] = []

  if (config.schemaVersion !== 2)
    failures.push('api-surface.json schemaVersion 应为 2（Experimental 已更名为 Evolving）')

  const classified = new Map<string, ApiTier>()
  for (const tier of ['stable', 'evolving'] as const) {
    for (const name of config.tiers[tier] ?? []) {
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

  const stableExceptions = new Set(config.allowStablePatternExceptions ?? [])
  for (const name of config.tiers.stable) {
    if (isStableReserved(name) && !stableExceptions.has(name)) {
      failures.push(
        `[stable] "${name}" 命中 Stable 保留模式（*Options / *Progress* / *LoggerOptions / LogWriteStream）：0.x 内这类形状只能待在 evolving；`
        + '确需 Stable 请加入 api-surface.json 的 allowStablePatternExceptions，并在 docs/engineering/api-stability.md §6 写明理由',
      )
    }
  }
  for (const name of stableExceptions) {
    if (!config.tiers.stable.includes(name))
      failures.push(`allowStablePatternExceptions 中的 "${name}" 不是 stable 条目（豁免只能用于已升 Stable 的名字，请移除）`)
  }

  failures.push(...validateMethodTiers(
    collectPublicMethods(serviceFiles),
    config.methodTiers?.evolving ?? [],
  ))

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

    for (const method of classMembers(file, className)) {
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
    writeExportIndex(exports, config)
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

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun)
  main()
