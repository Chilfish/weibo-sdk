import type { IUserDetailsResponse } from '../../types/raw/user/Details'
import type { IRequestResource } from '../internal/FetcherService'
import type { IUserInfoResponse } from '~/types/raw/user/Info'
import { User } from '~/models/data/User'
import { FetcherService } from '../internal/FetcherService'

export class UserService extends FetcherService {
  /**
   * 获取用户信息
   * @param id 用户ID (uid)
   */
  public async info(id: string): Promise<IUserInfoResponse> {
    const resource: IRequestResource = {
      method: 'GET',
      url: `https://weibo.com/ajax/profile/info`,
      headers: {
        referer: `https://weibo.com/u/${id}`,
      },
    }
    const data = await this.fetch<IUserInfoResponse>(resource, { uid: id })
    await this.onFetched('USER_INFO', data)
    return data
  }

  /**
   * 获取用户详情
   */
  public async details(id: string): Promise<IUserDetailsResponse> {
    const resource: IRequestResource = {
      method: 'GET',
      url: `https://weibo.com/ajax/profile/detail`,
      headers: {
        referer: `https://weibo.com/u/${id}`,
      },
    }
    const data = await this.fetch<IUserDetailsResponse>(resource, { uid: id })
    await this.onFetched('USER_DETAILS', data)
    return data
  }

  /**
   * 获取用户详情信息，返回解析后的 User 类
   */
  public async getById(id: string): Promise<User> {
    const [info, details] = await Promise.all([
      this.info(id),
      this.details(id),
    ])
    return new User(info.data.user, details.data)
  }
}
