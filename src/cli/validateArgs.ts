import type { ArgDef, ArgsDef, CommandDef, CommandMeta, Resolvable, SubCommandsDef } from 'citty'
import { InvalidConfigError } from '~/models/errors/ConfigError'

/**
 * 未知参数检查。
 *
 * citty 的 `parseArgs` 对未知 flag 是静默忽略的（`strict: false`），所以
 * `--max-item`（少一个 s）会变成「什么都没传」，`--gust` 会悄悄退回 `auto` 读取 `.env` 里的 Cookie。
 * 这两类错误在 agent / 脚本调用时极难发现，因此在 `runMain` 之前统一校验一次：
 * 未知 flag 直接 `CONFIG_INVALID`，并给出最接近的候选。
 */

/** citty 内建 flag（`_getBuiltinFlags`）：用户没有占用时才可用。 */
const BUILTIN_FLAGS = new Set(['help', 'h', 'version', 'v'])

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

/** 命令行里出现的一个 flag 名（已去掉 `-` / `--` 前缀与 `=value`）。 */
function flagName(token: string): string {
  const bare = token.replace(/^-+/, '')
  const eq = bare.indexOf('=')
  return eq === -1 ? bare : bare.slice(0, eq)
}

function hasInlineValue(token: string): boolean {
  return token.includes('=')
}

/** 参数定义里能接受的全部名字（主名 + 别名 + `no-` 变体）。 */
function acceptedNames(args: ArgsDef | undefined): Map<string, string> {
  const names = new Map<string, string>()
  for (const [name, def] of Object.entries(args ?? {})) {
    names.set(name, name)
    for (const alias of toArray((def as { alias?: string | string[] }).alias))
      names.set(alias, name)
    // citty 把 `--no-x` 当作 x 的取反；显式声明 `no-x` 的参数也接受同一个写法。
    names.set(`no-${name}`, name)
    const negative = /^no-(.+)$/.exec(name)
    if (negative)
      names.set(negative[1]!, name)
  }
  return names
}

/** 该参数是否要吃掉下一个 token（citty 的 `_isValueFlag`）。 */
function takesValue(args: ArgsDef | undefined, canonical: string): boolean {
  const def = (args ?? {})[canonical] as ArgDef | undefined
  return def?.type === 'string' || def?.type === 'enum'
}

/** 在整棵命令树里找某个 flag（用于提示「这个参数写在子命令之后」）。 */
async function hasOptionInTree(command: CommandDef, name: string): Promise<boolean> {
  const args = await resolveValue(command.args as Resolvable<ArgsDef> | undefined)
  if (acceptedNames(args).has(name))
    return true
  const subCommands = await resolveValue(command.subCommands as Resolvable<SubCommandsDef> | undefined)
  for (const sub of Object.values(subCommands ?? {})) {
    if (await hasOptionInTree((await resolveValue(sub as Resolvable<CommandDef>))!, name))
      return true
  }
  return false
}

/** 编辑距离，用于给未知 flag 找最接近的候选。 */
function distance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  let prev = Array.from({ length: cols }, (_, index) => index)
  for (let i = 1; i < rows; i += 1) {
    const current = [i]
    for (let j = 1; j < cols; j += 1) {
      current[j] = Math.min(
        prev[j]! + 1,
        current[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = current
  }
  return prev[cols - 1]!
}

function closest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    // 单字母别名（`-f` / `-c`）不作候选：提示 "--foo → --f" 只会更迷惑。
    if (candidate.length < 3)
      continue
    const value = distance(name, candidate)
    if (value < bestDistance) {
      bestDistance = value
      best = candidate
    }
  }
  return bestDistance <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined
}

function unknownFlagError(name: string, command: string, accepted: Iterable<string>): InvalidConfigError {
  const suggestion = closest(name, accepted)
  return new InvalidConfigError(
    suggestion
      ? `Unknown option --${name} for ${command}. Did you mean --${suggestion}?`
      : `Unknown option --${name} for ${command}.`,
    {
      field: name,
      command,
      ...(suggestion ? { suggestion } : {}),
      hint: '未知参数会被 citty 静默忽略，所以这里直接报错；用 --help 查看该命令支持的参数',
    },
  )
}

/**
 * 校验命令行里没有该（子）命令未声明的 flag。
 *
 * @throws `InvalidConfigError`（`CONFIG_INVALID`）——未知 flag、或 flag 放在了子命令之前
 * @param root 命令树根（`main`）
 * @param rawArgs `process.argv.slice(2)`
 */
export async function assertKnownFlags(root: CommandDef, rawArgs: readonly string[]): Promise<void> {
  let command = root
  let commandName = ((await resolveValue(root.meta)) as CommandMeta | undefined)?.name ?? 'weibo-cli'
  let args = await resolveValue(command.args as Resolvable<ArgsDef> | undefined)
  let positionals = 0

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index]!

    if (token === '--')
      return

    if (!token.startsWith('-') || token === '-') {
      const subCommands = await resolveValue(command.subCommands as Resolvable<SubCommandsDef> | undefined)
      const sub = subCommands?.[token]
      if (positionals === 0 && sub) {
        command = (await resolveValue(sub as Resolvable<CommandDef>))!
        commandName = `${commandName} ${token}`
        args = await resolveValue(command.args as Resolvable<ArgsDef> | undefined)
        continue
      }
      positionals += 1
      continue
    }

    const name = flagName(token)
    const normalized = name.startsWith('no-') ? name.slice(3) : name
    if (BUILTIN_FLAGS.has(name) || BUILTIN_FLAGS.has(normalized))
      continue

    const accepted = acceptedNames(args)
    const canonical = accepted.get(name) ?? accepted.get(normalized)
    if (canonical === undefined) {
      const error = unknownFlagError(name, commandName, accepted.keys())
      // 参数存在、只是写在了子命令之前（citty 会静默忽略）——给出更明确的修法。
      if (error.context && await hasOptionInTree(root, name))
        error.context.next = `参数由子命令自己声明：把 --${name} 写在子命令之后`
      throw error
    }

    // 值型参数的下一个 token 是它的值，不当成 flag 校验（`--since -1` 这类负数也不误报）。
    if (!hasInlineValue(token) && takesValue(args, canonical))
      index += 1
  }
}
