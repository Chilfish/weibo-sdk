import { InvalidConfigError } from '~/models/errors/ConfigError'

/** `archive user` 的诊断呈现方式。 */
export type LogFormat = 'pretty' | 'ndjson' | 'silent'

export interface LogFormatContext {
  env?: NodeJS.ProcessEnv
  isTTY?: boolean
}

const LOG_FORMATS = new Set<LogFormat>(['pretty', 'ndjson', 'silent'])

function envFlag(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

/**
 * 解析诊断呈现方式。
 *
 * 显式 `--log-format` 优先；`--quiet` 等价 silent；其余按 TTY / CI / TERM 自动降级。
 * 非法取值抛 `CONFIG_INVALID`，避免静默回退到另一种呈现。
 */
export function resolveLogFormat(args: Record<string, unknown>, context: LogFormatContext = {}): LogFormat {
  const raw = args['log-format']
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = raw.trim().toLowerCase() as LogFormat
    if (!LOG_FORMATS.has(value)) {
      throw new InvalidConfigError(`Unknown log format: ${JSON.stringify(raw)}`, {
        field: 'log-format',
        value: raw,
        supported: [...LOG_FORMATS],
      })
    }
    return value
  }

  if (args.quiet === true)
    return 'silent'

  const env = context.env ?? process.env
  const isTTY = context.isTTY ?? process.stderr.isTTY === true
  if (envFlag(env.CI) || env.TERM === 'dumb' || !isTTY)
    return 'ndjson'
  return 'pretty'
}

/** 是否允许使用原地刷新的状态块（光标控制）。 */
export function isInteractiveOutput(format: LogFormat, context: LogFormatContext & { noProgress?: boolean } = {}): boolean {
  if (format !== 'pretty' || context.noProgress === true)
    return false
  const env = context.env ?? process.env
  const isTTY = context.isTTY ?? process.stderr.isTTY === true
  return isTTY && !envFlag(env.CI) && env.TERM !== 'dumb'
}

/** 是否输出 ANSI 颜色；`NO_COLOR` 优先于 `FORCE_COLOR`。 */
export function supportsColor(context: LogFormatContext = {}): boolean {
  const env = context.env ?? process.env
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '')
    return false
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '')
    return envFlag(env.FORCE_COLOR)
  return context.isTTY ?? process.stderr.isTTY === true
}
