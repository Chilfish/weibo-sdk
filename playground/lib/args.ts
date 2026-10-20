import type { ParsedArgs } from './types'
import { parseArgs } from 'node:util'

/**
 * 场景公共 flag 表。
 *
 * `parseArgs` 只有在声明了选项类型时才会把 `--max-pages 1` 的 `1` 当作值；
 * 否则未知 flag 会退化成布尔，后续 token 被误读成位置参数（例如 uid）。
 */
const SCENARIO_OPTIONS = {
  'max-pages': { type: 'string' },
  'max-items': { type: 'string' },
  'count': { type: 'string' },
  'flow': { type: 'string' },
  'include': { type: 'string' },
  'tag': { type: 'string' },
  'since': { type: 'string' },
  'stop-at': { type: 'string' },
  'uid-file': { type: 'string' },
  'keyword': { type: 'string' },
  'since-id': { type: 'string' },
  'uid': { type: 'string' },
  'write': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'resume': { type: 'boolean' },
  'raw': { type: 'boolean' },
  'longtext': { type: 'boolean' },
  'likes': { type: 'boolean' },
  'comment-history': { type: 'boolean' },
  'images': { type: 'boolean' },
  'videos': { type: 'boolean' },
  'favorites': { type: 'boolean' },
  'reposts': { type: 'boolean' },
  'probe': { type: 'boolean' },
} as const

/** 解析场景参数：未知 flag 不报错，原样交给场景自己解释。 */
export function parseScenarioArgs(argv: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: SCENARIO_OPTIONS,
    allowPositionals: true,
    strict: false,
  })
  return {
    positionals,
    flags: values as ParsedArgs['flags'],
  }
}

function flagValue(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags[key]
  if (typeof value === 'string')
    return value
  if (Array.isArray(value))
    return value[value.length - 1]
  return undefined
}

export function flagString(args: ParsedArgs, key: string): string | undefined {
  return flagValue(args, key)
}

export function flagNumber(args: ParsedArgs, key: string, fallback: number): number {
  const raw = flagValue(args, key)
  if (raw === undefined)
    return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 支持 `--write` / `--no-write` / `--write=false` 三种写法。 */
export function flagBool(args: ParsedArgs, key: string, fallback = false): boolean {
  const value = args.flags[key]
  if (value === false || value === 'false' || value === '0' || value === 'no')
    return false
  if (value === true || value === 'true' || value === '1' || value === 'yes')
    return true

  const negated = args.flags[`no-${key}`]
  if (negated === true || negated === 'true')
    return false
  return fallback
}

/** 位置参数 → 环境变量 → 默认值（`--uid` 这类 flag 仍由场景自行优先处理）。 */
export function argument(
  args: ParsedArgs,
  index: number,
  envKey: string,
  env: Record<string, string>,
  fallback: string,
): string {
  return args.positionals[index] ?? env[envKey] ?? fallback
}
