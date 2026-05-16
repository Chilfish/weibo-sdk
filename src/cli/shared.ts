import type { IWeiboConfig } from '../types/config'
import { WeiboSDK } from '../WeiboSDK'

export function getCookie(args: Record<string, unknown>): string {
  return (args.cookie as string) || process.env.WEIBO_COOKIE || ''
}

export function createSDK(args: Record<string, unknown>): WeiboSDK {
  const cookie = getCookie(args)
  const config: IWeiboConfig = { cookie, selfCheck: { mode: 'lazy' } }
  return new WeiboSDK(config)
}

/** Shared --cookie arg definition, reused by every command */
export const cookieArg = {
  cookie: {
    type: 'string',
    description: '微博 Cookie（默认从 WEIBO_COOKIE 环境变量读取）',
    alias: 'c',
  },
} as const
