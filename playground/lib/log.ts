import type { PlaygroundLog } from './types'

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined

function paint(code: number, text: string): string {
  return useColor ? `\u001B[${code}m${text}\u001B[0m` : text
}

/** 把任意值压缩成一行、限长的可读文本。 */
export function excerpt(value: unknown, max = 90): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

/**
 * 把结构化错误拍平成可直接打印的 JSON。
 *
 * SDK 的错误统一携带 `code / level / retryable / hint / next / context`；
 * 这里做成结构化判断，避免示例依赖内部错误类。
 */
export function describeError(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const context = record.context && typeof record.context === 'object'
      ? record.context as Record<string, unknown>
      : {}
    if (typeof record.code === 'string') {
      return {
        name: record.name,
        code: record.code,
        level: record.level,
        retryable: record.retryable,
        message: record.message,
        ...(typeof context.hint === 'string' ? { hint: context.hint } : {}),
        ...(typeof context.next === 'string' ? { next: context.next } : {}),
        context,
      }
    }
  }
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  }
}

export function createLogger(scope: string): PlaygroundLog {
  return {
    heading: text => console.log(`\n${paint(36, `== ${scope} · ${text} ==`)}`),
    step: text => console.log(`\n${paint(90, '$')} ${text}`),
    info: text => console.log(`  ${text}`),
    warn: text => console.warn(`${paint(33, '  !')} ${text}`),
    error: text => console.error(`${paint(31, '  x')} ${text}`),
    kv: (key, value) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
      console.log(`  ${paint(90, key)}: ${text}`)
    },
    json: value => console.log(JSON.stringify(value, null, 2)),
    progress: (label, processed, total) => {
      console.log(`  ${paint(90, '·')} ${label} ${processed}${total === undefined ? '' : `/${total}`}`)
    },
  }
}
