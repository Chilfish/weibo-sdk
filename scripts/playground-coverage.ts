import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '..')
const PLAYGROUND = path.join(ROOT, 'playground')
const CONFIG_PATH = path.join(ROOT, 'api-surface.json')
const SDK_FACADE = path.join(ROOT, 'src/WeiboSDK.ts')
const SERVICE_DIR = path.join(ROOT, 'src/services/public')
const PACKAGE_NAME = '@chilfish/weibo-sdk'

interface ApiSurfaceConfig {
  tiers: {
    stable: string[]
    evolving: string[]
  }
}

interface MethodCall {
  service: string
  method: string
}

interface CallUsage {
  /** `sdk.users.getById()` 这类服务方法调用。 */
  serviceCalls: MethodCall[]
  /** `sdk.getSession()` 这类门面方法调用。 */
  facadeCalls: string[]
}

function listFiles(dir: string, suffix: string): string[] {
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
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'output')
        continue
      out.push(...listFiles(full, suffix))
    }
    else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(full)
    }
  }
  return out
}

function parseSource(file: string, text = readFileSync(file, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
}

/** 从 `@chilfish/weibo-sdk` 的 import 声明里收集符号名（含 `import type`）。 */
export function collectImportedNames(source: ts.SourceFile): string[] {
  const names: string[] = []
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue
    if (statement.moduleSpecifier.text !== PACKAGE_NAME)
      continue
    const clause = statement.importClause
    if (!clause)
      continue
    if (clause.name)
      names.push(clause.name.text)
    const bindings = clause.namedBindings
    if (!bindings)
      continue
    if (ts.isNamedImports(bindings)) {
      for (const element of bindings.elements)
        names.push(element.name.text)
    }
    else if (ts.isNamespaceImport(bindings)) {
      names.push(bindings.name.text)
    }
  }
  return names
}

/**
 * 收集场景里实际调用到的方法。
 *
 * 只看 `xxx.<service>.<method>(...)` 与 `xxx.<facadeMethod>(...)` 两种链式调用，
 * 避免把 `array.map()` 之类的同名方法误算成 SDK 覆盖。
 */
export function collectCallUsage(source: ts.SourceFile, serviceProps: ReadonlySet<string>, facadeMethods: ReadonlySet<string>): CallUsage {
  const serviceCalls: MethodCall[] = []
  const facadeCalls: string[] = []

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = node.expression.expression

      if (ts.isPropertyAccessExpression(receiver) && serviceProps.has(receiver.name.text))
        serviceCalls.push({ service: receiver.name.text, method })

      if (ts.isIdentifier(receiver) && facadeMethods.has(method))
        facadeCalls.push(method)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return { serviceCalls, facadeCalls }
}

/** `WeiboSDK` 的 public readonly 服务属性 → Service 类名。 */
export function readServiceProps(file = SDK_FACADE): Map<string, string> {
  const source = parseSource(file)
  const props = new Map<string, string>()

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== 'WeiboSDK')
      continue
    for (const member of statement.members) {
      if (!ts.isPropertyDeclaration(member) || !member.name || !ts.isIdentifier(member.name))
        continue
      if (!member.type || !ts.isTypeReferenceNode(member.type) || !ts.isIdentifier(member.type.typeName))
        continue
      const className = member.type.typeName.text
      if (className.endsWith('Service'))
        props.set(member.name.text, className)
    }
  }
  return props
}

/** 类的公开方法名（跳过 private / protected / static 与 `@internal`）。 */
export function readPublicMethods(file: string, className: string): string[] {
  const source = parseSource(file)
  const names: string[] = []

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== className)
      continue
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name))
        continue
      const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : []
      if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword
        || modifier.kind === ts.SyntaxKind.ProtectedKeyword
        || modifier.kind === ts.SyntaxKind.StaticKeyword)) {
        continue
      }
      const internal = ts.getJSDocCommentsAndTags(member).some(doc =>
        ts.isJSDoc(doc) && (doc.tags?.some(tag => tag.tagName.text === 'internal') ?? false))
      if (internal)
        continue
      names.push(member.name.text)
    }
  }

  return names
}

function readConfig(): ApiSurfaceConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ApiSurfaceConfig
}

function main(): void {
  const args = new Set(process.argv.slice(2))
  const json = args.has('--json')
  const strict = args.has('--strict')

  const serviceProps = readServiceProps()
  const serviceFiles = new Map<string, string>()
  for (const file of listFiles(SERVICE_DIR, '.ts')) {
    const text = readFileSync(file, 'utf8')
    const match = text.match(/export class (\w+)/)
    if (match)
      serviceFiles.set(match[1], file)
  }
  const facadeMethods = new Set(readPublicMethods(SDK_FACADE, 'WeiboSDK'))
  const methodsByService = new Map<string, string[]>()
  for (const [prop, className] of serviceProps) {
    const file = serviceFiles.get(className)
    if (file)
      methodsByService.set(prop, readPublicMethods(file, className))
  }

  const imported = new Set<string>()
  const usedMethods = new Set<string>()
  const usedFacade = new Set<string>()
  const files = listFiles(PLAYGROUND, '.ts')

  for (const file of files) {
    const source = parseSource(file)
    for (const name of collectImportedNames(source))
      imported.add(name)
    const usage = collectCallUsage(source, new Set(serviceProps.keys()), facadeMethods)
    for (const call of usage.serviceCalls) {
      const known = methodsByService.get(call.service) ?? []
      if (known.includes(call.method))
        usedMethods.add(`${call.service}.${call.method}`)
    }
    for (const name of usage.facadeCalls)
      usedFacade.add(name)
  }

  const config = readConfig()
  const stableExports = [...config.tiers.stable].sort((a, b) => a.localeCompare(b))
  const missingExports = stableExports.filter(name => !imported.has(name))

  const allMethods: string[] = []
  for (const [prop, methods] of methodsByService) {
    for (const method of methods)
      allMethods.push(`${prop}.${method}`)
  }
  allMethods.sort((a, b) => a.localeCompare(b))
  const missingMethods = allMethods.filter(key => !usedMethods.has(key))
  const missingFacade = [...facadeMethods].filter(name => !usedFacade.has(name)).sort()

  const exportCoverage = stableExports.length === 0 ? 1 : (stableExports.length - missingExports.length) / stableExports.length

  if (json) {
    console.log(JSON.stringify({
      files: files.length,
      stableExports: {
        total: stableExports.length,
        covered: stableExports.length - missingExports.length,
        missing: missingExports,
      },
      methods: {
        total: allMethods.length,
        covered: allMethods.length - missingMethods.length,
        missing: missingMethods,
      },
      facade: {
        total: facadeMethods.size,
        missing: missingFacade,
      },
    }, null, 2))
  }
  else {
    console.log('Playground coverage')
    console.log(`  files: ${files.length}`)
    console.log(`  Stable exports: ${stableExports.length - missingExports.length}/${stableExports.length} (${(exportCoverage * 100).toFixed(1)}%)`)
    console.log(`  public methods: ${allMethods.length - missingMethods.length}/${allMethods.length}`)
    console.log(`  facade methods: ${facadeMethods.size - missingFacade.length}/${facadeMethods.size}`)

    if (missingExports.length > 0) {
      console.log(`\n未被引用的 Stable 导出 (${missingExports.length}):`)
      for (const name of missingExports)
        console.log(`  ${name}`)
    }
    if (missingMethods.length > 0) {
      console.log(`\n未被调用的公开方法 (${missingMethods.length}):`)
      for (const key of missingMethods)
        console.log(`  ${key}`)
    }
    if (missingFacade.length > 0) {
      console.log(`\n未被调用的门面方法 (${missingFacade.length}):`)
      for (const name of missingFacade)
        console.log(`  sdk.${name}()`)
    }
    if (missingExports.length === 0 && missingMethods.length === 0 && missingFacade.length === 0)
      console.log('\n全部 Stable 导出与公开方法都在 playground 中出现过。')
  }

  if (strict && (missingExports.length > 0 || missingMethods.length > 0 || missingFacade.length > 0))
    process.exitCode = 1
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun)
  main()
