import { InvalidConfigError } from '../models/errors/ConfigError'

/** 查询命令的输出格式；`json` 是默认值，保持脚本 / 管道兼容。 */
export type OutputFormat = 'json' | 'markdown'

const FORMAT_ALIASES: Record<string, OutputFormat> = {
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
}

/** 各命令共用的 `--format` / `-f` 参数定义。 */
export const outputFormatArg = {
  format: {
    type: 'string',
    description: '输出格式：json | markdown（默认 json；md 同 markdown）',
    alias: 'f',
  },
} as const

/**
 * 解析 `--format` 取值。
 *
 * 未指定时返回 `json`；未知取值抛 `CONFIG_INVALID`，不静默回退，
 * 避免调用方以为拿到了想要的视图却拿到另一种格式。
 */
export function parseOutputFormat(value: unknown): OutputFormat {
  if (value === undefined || value === '')
    return 'json'

  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const format = FORMAT_ALIASES[key]
  if (!format) {
    throw new InvalidConfigError(`Unknown output format: ${String(value)}`, {
      field: 'format',
      value,
      supported: Object.keys(FORMAT_ALIASES),
    })
  }
  return format
}

/** 非 JSON 格式的渲染器；每个命令只提供自己支持的那几种。 */
export interface OutputRenderers<T> {
  markdown: (value: T) => string
}

/**
 * 按格式把数据渲染成字符串（不写 stdout，便于单测）。
 *
 * `json` 固定为 2 空格缩进，与既有 CLI 输出保持一致。
 */
export function renderOutput<T>(value: T, format: OutputFormat, renderers: OutputRenderers<T>): string {
  if (format === 'json')
    return JSON.stringify(value, null, 2)
  return renderers[format](value)
}

/**
 * 解析一次 `--format`，返回命令内复用的打印函数。
 *
 * 在发请求之前调用：非法格式不会先打一次网络。
 */
export function createPrinter(args: Record<string, unknown>): <T>(value: T, renderers: OutputRenderers<T>) => void {
  const format = parseOutputFormat(args.format)
  return (value, renderers) => {
    console.log(renderOutput(value, format, renderers))
  }
}
