import type { IWeiboConfig } from '../../types/config'
import type { IUser } from '../../types/domain/IUser'
import type { IUserRawResponse } from '../../types/raw/User'
// src/services/public/UserService.ts
import type { IRequestResource } from '../internal/FetcherService'
import { UserNormalizer } from '../../utils/Normalizer'
import { AuthService } from '../internal/AuthService'
import { FetcherService } from '../internal/FetcherService'
import { RateLimitService } from '../internal/RateLimitService'

export class UserService {
  private fetcher: FetcherService
  private auth: AuthService
  private rateLimit: RateLimitService

  constructor(config: IWeiboConfig) {
    this.fetcher = new FetcherService(config)
    this.auth = new AuthService(config)
    this.rateLimit = new RateLimitService(
      config.maxConcurrent || 3,
      typeof config.delay === 'number' ? config.delay : 1000,
    )
  }

  /**
   * 获取用户详情
   * @param id 用户ID (uid)
   */
  async details(id: string): Promise<IUser> {
    // 速率控制
    await this.rateLimit.acquire()

    // 构建请求
    const resource: IRequestResource = {
      method: 'GET',
      url: 'https://weibo.com/ajax/profile/info',
      headers: this.auth.getAuthHeaders(),
    }

    // 发送请求
    const raw = await this.fetcher.fetch<IUserRawResponse>(resource, { uid: id })

    // 转换为领域模型
    return UserNormalizer.normalize(raw)
  }
}
