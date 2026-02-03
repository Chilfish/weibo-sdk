import type { IUserInfoResponse } from '~/types/raw/user/Info'
import type { IUserDetailsResponse } from '../../types/raw/user/Details'
import type { IRequestResource } from '../internal/FetcherService'
import { FetcherService } from '../internal/FetcherService'

export class UserService extends FetcherService {
  /**
   * 获取用户信息
   * @param id 用户ID (uid)
   */
  async info(id: string): Promise<IUserInfoResponse> {
    const resource: IRequestResource = {
      method: 'GET',
      url: `https://weibo.com/ajax/profile/info`,
      headers: {
        referer: `https://weibo.com/u/${id}`,
      }
    }
    const raw = await this.fetch<IUserInfoResponse>(resource, { uid: id })

    return raw
  }
}
