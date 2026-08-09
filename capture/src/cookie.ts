// capture/src/cookie.ts — cookie 字符串解析为 CDP Network.setCookie 参数（纯函数）
import type { CookieParam } from './types'

export function parseCookies(cookieStr: string, domain: string): CookieParam[] {
  return cookieStr
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf('=')
      return {
        name: part.slice(0, i).trim(),
        value: part.slice(i + 1).trim(),
        domain,
        path: '/',
      }
    })
}
