import type { IWeiboConfig } from '../types/config'
import { join, resolve } from 'node:path'
import { WeiboSDKError } from '../models/errors/WeiboSDKError'
import { resolveCookieInput } from '../utils/cookieInput'
import { readEnvValue } from '../utils/envFile'
import { WeiboSDK } from '../WeiboSDK'
import { parsePositiveInt } from './parseArgs'

/**
 * 把任意错误转换成 CLI 的 JSON 错误信封（stderr）。
 *
 * 结构化错误额外携带 `code` / `level` / `retryable` / `hint` / `next`，
 * 让 Agent / 脚本能在不解析自然语言的情况下决定下一步。
 */
export function formatCliError(error: unknown): Record<string, unknown> {
  if (error instanceof WeiboSDKError) {
    const context = error.context ?? {}
    return {
      event: 'error',
      code: error.code,
      level: error.level,
      retryable: error.retryable,
      message: error.message,
      ...(typeof context.endpoint === 'string' ? { endpoint: context.endpoint } : {}),
      ...(typeof context.hint === 'string' ? { hint: context.hint } : {}),
      ...(typeof context.next === 'string' ? { next: context.next } : {}),
      context,
    }
  }
  return {
    event: 'error',
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
  }
}

/** `--env-file` 指定路径（相对路径按 pwd 解析），默认 `<pwd>/.env` */
export function getEnvFilePath(args: Record<string, unknown>): string {
  const file = args['env-file'] as string | undefined
  return file ? resolve(process.cwd(), file) : join(process.cwd(), '.env')
}

/**
 * Cookie 只从 .env 文件读取（默认 `<pwd>/.env`），不回退到 `process.env`。
 * `--cookie` 作为显式覆盖优先级最高。
 *
 * 取值可以是 Cookie header 串，也可以是 Cookie 文件路径（Netscape 或 header 串内容），
 * 由 `resolveCookieInput` 统一解析；解析失败时打印结构化错误并以 1 退出。
 */
export function getCookie(args: Record<string, unknown>): string {
  const explicit = args.cookie as string | undefined
  const raw = explicit || readEnvValue(getEnvFilePath(args), 'WEIBO_COOKIE') || ''

  try {
    return resolveCookieInput(raw)
  }
  catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

/**
 * archive 的负向开关（citty：`--no-reposts` 会把 `reposts` 设为 false，而非产出 `no-reposts`）。
 *
 * 收藏是账号级数据（`all_fav` 忽略 uid），批量归档默认关闭；单账号仍默认开启。
 * 未传时其余阶段默认全部开启。
 */
export function resolveArchiveIncludeFlags(
  args: {
    'reposts'?: boolean
    'favorites'?: boolean
    'date-slices'?: boolean
  },
  options: { batch?: boolean } = {},
): { includeReposts: boolean, includeFavorites: boolean, includeDateSlices: boolean } {
  return {
    includeReposts: args.reposts !== false,
    includeFavorites: args.favorites ?? !options.batch,
    includeDateSlices: args['date-slices'] !== false,
  }
}

export function createSDK(args: Record<string, unknown>): WeiboSDK {
  const cookie = getCookie(args)
  const config: IWeiboConfig = { cookie, selfCheck: { mode: 'lazy' } }
  return new WeiboSDK(config)
}

/** Shared cookie args, reused by every command */
export const cookieArg = {
  'cookie': {
    type: 'string',
    description: '微博 Cookie 或 Cookie 文件路径（Netscape cookies.txt / header 串；显式覆盖，默认从 --env-file 指定的 .env 读取）',
    alias: 'c',
  },
  'env-file': {
    type: 'string',
    description: '环境文件路径（默认 <pwd>/.env）',
  },
} as const

/** 流式命令共用的条数上限。 */
export const streamLimitArg = {
  'max-items': {
    type: 'string',
    description: '最多产出条数（可选，默认不限；按跨页去重后的条目计数）',
  },
} as const

/** 时间倒序的流额外支持日期边界（`--since-id` 仍是游标，不是日期）。 */
export const streamRangeArg = {
  ...streamLimitArg,
  since: {
    type: 'string',
    description: '时间下界：YYYY-MM-DD / YYYYMMDD 或 unix 秒（可选，含当天；更早的条目停止翻页）',
  },
  until: {
    type: 'string',
    description: '时间上界：YYYY-MM-DD / YYYYMMDD 或 unix 秒（可选，含当天；更晚的条目跳过）',
  },
} as const

/** 从 CLI 参数解析出流式范围（未传的字段保持 undefined）。 */
export function streamRangeFromArgs(args: Record<string, unknown>): {
  maxItems?: number
  since?: string
  until?: string
} {
  return {
    maxItems: parsePositiveInt(args['max-items']),
    since: typeof args.since === 'string' && args.since.trim() !== '' ? args.since : undefined,
    until: typeof args.until === 'string' && args.until.trim() !== '' ? args.until : undefined,
  }
}
