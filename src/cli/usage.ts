import type { Arg, ArgsDef, CommandDef, CommandMeta, Resolvable, SubCommandsDef } from 'citty'

/**
 * 帮助信息渲染。
 *
 * 自带的 `renderUsage`（citty 0.2.2）按 `String.length` 对齐列，中文字符在终端占两列，
 * 于是 COMMANDS / OPTIONS 表格会错位；多行 description 还会被当成一个单元格补齐，
 * 让整张表每行都拖出几百个空格。这里按显示宽度重新对齐，并把多行描述拆成续行。
 *
 * 只覆盖本项目用到的用法（positional / string / boolean / enum / 子命令），
 * 行为与 citty 保持一致：同样的段落顺序、`--no-*` 变体、默认值后缀。
 */

const ANSI = {
  bold: (text: string) => paint(1, 22, text),
  underline: (text: string) => paint(4, 24, text),
  cyan: (text: string) => paint(36, 39, text),
  gray: (text: string) => paint(90, 39, text),
}

const noColor = (() => {
  const env = globalThis.process?.env ?? {}
  return env.NO_COLOR === '1' || env.TERM === 'dumb' || env.CI !== undefined
})()

function paint(open: number, close: number, text: string): string {
  return noColor ? text : `\u001B[${open}m${text}\u001B[${close}m`
}

/** 零宽字符（组合符号 / 变体选择符）：不占终端列。 */
function isZeroWidth(code: number): boolean {
  return (code >= 0x0300 && code <= 0x036F)
    || (code >= 0x200B && code <= 0x200F)
    || (code >= 0xFE00 && code <= 0xFE0F)
    || code === 0xFEFF
}

/** 宽字符（CJK / 全角 / emoji）：占两列。 */
function isWide(code: number): boolean {
  return (code >= 0x1100 && code <= 0x115F)
    || (code >= 0x2E80 && code <= 0xA4CF)
    || (code >= 0xA960 && code <= 0xA97F)
    || (code >= 0xAC00 && code <= 0xD7A3)
    || (code >= 0xF900 && code <= 0xFAFF)
    || (code >= 0xFE10 && code <= 0xFE19)
    || (code >= 0xFE30 && code <= 0xFE6F)
    || (code >= 0xFF00 && code <= 0xFF60)
    || (code >= 0xFFE0 && code <= 0xFFE6)
    || (code >= 0x1F300 && code <= 0x1F64F)
    || (code >= 0x1F900 && code <= 0x1F9FF)
    || (code >= 0x20000 && code <= 0x3FFFD)
}

/** ANSI 转义序列（用构造器避免在正则字面量里出现控制字符）。 */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(0x1B)}\\[[0-9;]*m`, 'g')

/** 去掉 ANSI 转义序列后再算宽度。 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

/** 字符串在终端里占的列数（CJK 记 2 列）。 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of stripAnsi(text)) {
    const code = char.codePointAt(0) ?? 0
    if (isZeroWidth(code))
      continue
    width += isWide(code) ? 2 : 1
  }
  return width
}

function padTo(text: string, width: number): string {
  const missing = width - displayWidth(text)
  return missing > 0 ? `${text}${' '.repeat(missing)}` : text
}

/** 两列表格：第一列按宽度右对齐补齐，第二列左对齐，续行缩进到第二列起点。 */
function renderTable(rows: Array<[string, string]>, prefix = '  '): string {
  const labelWidth = rows.reduce((max, [label]) => Math.max(max, displayWidth(label)), 0)
  const lines: string[] = []
  for (const [label, description] of rows) {
    const [first = '', ...rest] = description.split('\n')
    const start = `${prefix}${padTo(label, labelWidth)}  `
    lines.push(`${start}${first}`.trimEnd())
    const indent = ' '.repeat(displayWidth(start))
    for (const line of rest)
      lines.push(`${indent}${line}`.trimEnd())
  }
  return lines.join('\n')
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined)
    return []
  return Array.isArray(value) ? value : [value]
}

async function resolveValue<T>(value: Resolvable<T> | undefined): Promise<T | undefined> {
  if (typeof value === 'function')
    return await (value as () => T | Promise<T>)()
  return await value
}

function resolveArgs(args: ArgsDef | undefined): Arg[] {
  return Object.entries(args ?? {}).map(([name, def]) => ({
    ...def,
    name,
    alias: toArray((def as { alias?: string | string[] }).alias),
  })) as Arg[]
}

function valueHint(arg: Arg): string {
  const explicit = arg.valueHint ? `=<${arg.valueHint}>` : ''
  if (!arg.type || arg.type === 'positional' || arg.type === 'boolean')
    return explicit
  const options = (arg as { options?: string[] }).options
  if (arg.type === 'enum' && options && options.length > 0)
    return `=<${options.join('|')}>`
  return explicit || `=<${arg.name.replace(/[-_ ]+/g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}>`
}

function describe(arg: Arg, required: boolean): string {
  return [
    arg.description,
    required ? ANSI.gray('(Required)') : '',
    arg.default === undefined ? '' : ANSI.gray(`(Default: ${arg.default})`),
  ].filter(Boolean).join(' ')
}

function isNegativeName(name: string): boolean {
  return /^no[-A-Z]/.test(name)
}

/** 渲染 `--help`（结构与 citty 的 `renderUsage` 一致）。 */
export async function renderCliUsage<T extends ArgsDef = ArgsDef>(command: CommandDef<T>, parent?: CommandDef<T>): Promise<string> {
  const meta = (await resolveValue(command.meta)) ?? {}
  const parentMeta = (await resolveValue(parent?.meta)) ?? {}
  const commandName = `${parentMeta.name ? `${parentMeta.name} ` : ''}${meta.name ?? process.argv[1] ?? ''}`
  const args = resolveArgs(await resolveValue(command.args))

  const argRows: Array<[string, string]> = []
  const positionalRows: Array<[string, string]> = []
  const commandRows: Array<[string, string]> = []
  const usageParts: string[] = []

  for (const arg of args) {
    if (arg.type === 'positional') {
      const name = arg.name.toUpperCase()
      const required = arg.required !== false && arg.default === undefined
      positionalRows.push([ANSI.cyan(name + valueHint(arg)), describe(arg, required)])
      usageParts.push(required ? `<${name}>` : `[${name}]`)
      continue
    }

    const required = arg.required === true && arg.default === undefined
    const label = [...arg.alias.map(alias => `-${alias}`), `--${arg.name}`].join(', ') + valueHint(arg)
    argRows.push([ANSI.cyan(label), describe(arg, required)])
    const negativeDescription = (arg as { negativeDescription?: string }).negativeDescription
    if (arg.type === 'boolean' && (arg.default === true || negativeDescription !== undefined) && !isNegativeName(arg.name)) {
      const negative = [...arg.alias.map(alias => `--no-${alias}`), `--no-${arg.name}`].join(', ')
      argRows.push([ANSI.cyan(negative), negativeDescription ?? ''])
    }
    if (required)
      usageParts.push(`--${arg.name}${valueHint(arg)}`)
  }

  const subCommands = await resolveValue(command.subCommands as Resolvable<SubCommandsDef> | undefined)
  if (subCommands && Object.keys(subCommands).length > 0) {
    const names: string[] = []
    for (const [name, rawSub] of Object.entries(subCommands)) {
      const subMeta = (await resolveValue((await resolveValue(rawSub))?.meta)) as CommandMeta | undefined
      if (subMeta?.hidden)
        continue
      const aliases = toArray(subMeta?.alias)
      commandRows.push([ANSI.cyan([name, ...aliases].join(', ')), subMeta?.description ?? ''])
      names.push(name, ...aliases)
    }
    usageParts.push(names.join('|'))
  }

  const version = meta.version ?? parentMeta.version
  const optionSummary = argRows.length > 0 || positionalRows.length > 0 ? ' [OPTIONS]' : ''
  const lines: string[] = [
    ANSI.gray(`${meta.description ?? ''} (${commandName}${version ? ` v${version}` : ''})`),
    '',
    `${ANSI.underline(ANSI.bold('USAGE'))} ${ANSI.cyan(`${commandName}${optionSummary} ${usageParts.join(' ')}`)}`,
    '',
  ]

  if (positionalRows.length > 0)
    lines.push(ANSI.underline(ANSI.bold('ARGUMENTS')), '', renderTable(positionalRows), '')
  if (argRows.length > 0)
    lines.push(ANSI.underline(ANSI.bold('OPTIONS')), '', renderTable(argRows), '')
  if (commandRows.length > 0) {
    lines.push(
      ANSI.underline(ANSI.bold('COMMANDS')),
      '',
      renderTable(commandRows),
      '',
      `Use ${ANSI.cyan(`${commandName} <command> --help`)} for more information about a command.`,
    )
  }

  return lines.join('\n')
}

/** `--help` 的入口（等价于 citty 的 `showUsage`，但按显示宽度对齐）。 */
export async function showCliUsage<T extends ArgsDef = ArgsDef>(command: CommandDef<T>, parent?: CommandDef<T>): Promise<void> {
  console.log(`${await renderCliUsage(command, parent)}\n`)
}
