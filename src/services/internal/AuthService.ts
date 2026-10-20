import type { IWeiboConfig } from '../../types/config'
import { resolveCookieInput } from '../../utils/cookieInput'

export class AuthService {
  private cookie: string
  private xsrfToken: string

  constructor(config: IWeiboConfig) {
    this.cookie = resolveCookieInput(config.cookie)
    this.xsrfToken = config.xsrfToken || this.extractXsrfToken(this.cookie)
  }

  private extractXsrfToken(cookie: string): string {
    const match = cookie.match(/XSRF-TOKEN=([^;]+)/)
    return match ? match[1] : ''
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
