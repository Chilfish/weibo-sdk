import type { IWeiboConfig } from '../types/config'
import { join, resolve } from 'node:path'
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
 */
export function getCookie(args: Record<string, unknown>): string {
  const explicit = args.cookie as string | undefined
  if (explicit)
    return explicit
  return readEnvValue(getEnvFilePath(args), 'WEIBO_COOKIE') ?? ''
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
    description: '微博 Cookie（显式覆盖，默认从 --env-file 指定的 .env 读取）',
    alias: 'c',
  },
  'env-file': {
    type: 'string',
    description: '环境文件路径（默认 <pwd>/.env）',
  },
} as const
