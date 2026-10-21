import type { IWeiboConfig } from '../../types/config'
import { resolveCookieInput } from '../../utils/cookieInput'

/** 非加密指纹：只用于观测标识，不能反推出 Cookie。 */
function fingerprint(input: string): string {
  let hash = 0x811C9DC5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export class AuthService {
  private cookie: string
  private xsrfToken: string

  constructor(config: IWeiboConfig) {
    this.cookie = resolveCookieInput(config.cookie ?? '')
    this.xsrfToken = config.xsrfToken || this.extractXsrfToken(this.cookie)
  }

  private extractXsrfToken(cookie: string): string {
    const match = cookie.match(/XSRF-TOKEN=([^;]+)/)
    return match ? match[1] : ''
  }

  /** 非敏感凭证标识（telemetry / 错误 context；不含 Cookie 明文）。 */
  getCredentialId(): string {
    return `cookie-${fingerprint(this.cookie)}`
  }

  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Cookie: this.cookie,
    }
    if (this.xsrfToken) {
      headers['X-XSRF-TOKEN'] = this.xsrfToken
    }
    return headers
  }

  validate(): boolean {
    return !!this.cookie && this.cookie.includes('SUB=')
  }
}
