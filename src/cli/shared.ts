import type { IWeiboConfig } from '../types/config'
import { join, resolve } from 'node:path'
import { resolveCookieInput } from '../utils/cookieInput'
import { readEnvValue } from '../utils/envFile'
import { WeiboSDK } from '../WeiboSDK'

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
 * 未传时默认全部开启。
 */
export function resolveArchiveIncludeFlags(args: {
  'reposts'?: boolean
  'favorites'?: boolean
  'date-slices'?: boolean
}): { includeReposts: boolean, includeFavorites: boolean, includeDateSlices: boolean } {
  return {
    includeReposts: args.reposts !== false,
    includeFavorites: args.favorites !== false,
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
