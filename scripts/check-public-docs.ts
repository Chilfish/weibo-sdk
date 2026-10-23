import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '..')
const WEBSITE = path.join(ROOT, 'website')
const README = path.join(ROOT, 'README.md')
const SESSION_TYPES = path.join(ROOT, 'src/types/session.ts')
const SDK_FACADE = path.join(ROOT, 'src/WeiboSDK.ts')

const FORBIDDEN: Array<{ pattern: RegExp, reason: string }> = [
  { pattern: /[A-Za-z]:\\dev\\/, reason: '本机路径' },
  { pattern: /\]\((?!https?:\/\/)[^)]*docs\/(?:engineering|planning|postmortem|development-log|archive)\//, reason: '指向内部文档的相对链接' },
  { pattern: /\]\((?!https?:\/\/)[^)]*\.agents\//, reason: '指向仓库内部 Agent 文档的相对链接' },
  { pattern: /\]\((?:\.\.\/)+AGENTS\.md/, reason: '指向内部 AGENTS.md 的相对链接' },
]

/** 一段代码上下文（fenced block 的一行，或一个行内 code span）及其所在行号。 */
export interface CodeSegment {
  line: number
  code: string
}

/** 待扫描的公开文档及其内容。`path` 只用于报错，必须是可读的相对路径。 */
export interface DocFile {
  path: string
  text: string
}

export interface DocMemberDriftInput {
  files: DocFile[]
  /** `interface WeiboSessionContext` 的全部公开字段。 */
  sessionFields: string[]
  /** `class WeiboSDK` 的公开成员（readonly 服务属性 + 公开方法 / getter）。 */
  sdkMembers: string[]
}

/**
 * 抽出「代码上下文」：fenced code block 的每一行 + 行内 code span。
 *
 * 只扫描代码是刻意的：散文里出现 `session` / `sdk` 只是叙述，不能当作字段引用；
 * 反过来，代码片段是下游会复制粘贴的部分，字段写错就是缺陷。
 */
export function extractCodeSegments(text: string): CodeSegment[] {
  const segments: CodeSegment[] = []
  const prose: Array<{ line: number, text: string }> = []
  let inFence = false

  text.split('\n').forEach((raw, index) => {
    const line = index + 1
    if (/^\s*(?:```|~~~)/.test(raw)) {
      inFence = !inFence
      return
    }
    if (inFence) {
      segments.push({ line, code: raw })
      return
    }
    prose.push({ line, text: raw })
  })

  // 行内 code span：同一行内成对的反引号之间。奇数下标即是 span 内容。
  for (const { line, text: proseLine } of prose) {
    const parts = proseLine.split('`')
    for (let index = 1; index < parts.length; index += 2)
      segments.push({ line, code: parts[index] })
  }

  return segments
}

/** `session.x` / `sdk.x` / `sdk?.x`；刻意不匹配计算访问 `sdk[name]` 与前缀（如 `weibo-sdk.md`）。 */
const MEMBER_ACCESS = /(?<![\w$.-])(session|sdk)(\?)?\.([A-Za-z_$][\w$]*)/g

function describeAllowed(allowed: string[]): string {
  return [...allowed].sort((a, b) => a.localeCompare(b)).join('、')
}

/**
 * 文档里 `session.<x>` / `sdk.<x>` 与实际公开成员的一致性检查（纯函数，不碰磁盘）。
 *
 * 返回可直接打印的失败说明（含文件、行号、表达式与允许集合）。
 */
export function findDocMemberDrift(input: DocMemberDriftInput): string[] {
  const sessionFields = new Set(input.sessionFields)
  const sdkMembers = new Set(input.sdkMembers)
  const failures: string[] = []

  for (const file of input.files) {
    for (const segment of extractCodeSegments(file.text)) {
      for (const match of segment.code.matchAll(MEMBER_ACCESS)) {
        const [expression, owner, , member] = match
        const allowed = owner === 'session' ? sessionFields : sdkMembers
        if (allowed.has(member))
          continue
        const ownerName = owner === 'session' ? 'WeiboSessionContext' : 'WeiboSDK'
        failures.push(
          `${file.path}:${segment.line}: \`${expression}\` 不是 ${ownerName} 的公开成员（允许：${describeAllowed([...allowed])}）`,
        )
      }
    }
  }

  return failures
}

function readSourceFile(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
}

/** `interface WeiboSessionContext` 的全部字段名（这个类型只有属性）。 */
export function readSessionFields(file: string = SESSION_TYPES): string[] {
  const source = readSourceFile(file)
  const names: string[] = []
  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== 'WeiboSessionContext')
      continue
    for (const member of statement.members) {
      if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name))
        names.push(member.name.text)
    }
  }
  return names
}

/** `class WeiboSDK` 的公开成员：跳过 private / protected / static 与 JSDoc `@internal`。 */
export function readSdkMembers(file: string = SDK_FACADE): string[] {
  const source = readSourceFile(file)
  const names: string[] = []
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== 'WeiboSDK')
      continue
    for (const member of statement.members) {
      if (!member.name || !ts.isIdentifier(member.name))
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

function markdownFiles(dir: string): string[] {
  const out: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  }
  catch {
    return out
  }
  for (const entry of entries) {
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

function relativeToRoot(file: string): string {
  return path.relative(ROOT, file).replaceAll('\\', '/')
}

function checkForbiddenReferences(files: string[]): string[] {
  const failures: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(text))
        failures.push(`${relativeToRoot(file)}: 出现${rule.reason}（${rule.pattern}）`)
    }
  }
  return failures
}

function main(): void {
  const websiteFiles = markdownFiles(WEBSITE)
  const docFiles: DocFile[] = [
    ...websiteFiles.map(file => ({ path: relativeToRoot(file), text: readFileSync(file, 'utf8') })),
    { path: relativeToRoot(README), text: readFileSync(README, 'utf8') },
  ]

  const failures = [
    ...checkForbiddenReferences(websiteFiles),
    ...findDocMemberDrift({
      files: docFiles,
      sessionFields: readSessionFields(),
      sdkMembers: readSdkMembers(),
    }),
  ]

  if (failures.length > 0) {
    console.error(`公开文档检查失败（${failures.length}）：\n`)
    for (const failure of failures)
      console.error(`- ${failure}`)
    console.error('\n提示：`session.*` 以 src/types/session.ts 的 WeiboSessionContext 为准，`sdk.*` 以 src/WeiboSDK.ts 的公开成员为准。')
    process.exit(1)
  }

  console.log(
    `公开文档检查通过：${websiteFiles.length} 个站点页面 + README.md，未发现内部引用或字段漂移。`,
  )
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun)
  main()
