import type { IWeiboConfig } from '~/types/config'
import type { IUserDetailsResponse } from '~/types/raw/user/Details'
import type { IUserInfoResponse } from '~/types/raw/user/Info'
import { User } from '~/models/data/User'
import { FetcherService } from '../internal/FetcherService'
import { myDetailsSpec, userDetailsSpec, userInfoSpec } from '../endpoints/user'

export class UserService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取用户信息
   * @param id 用户ID (uid)
   */
  public async info(id: string): Promise<IUserInfoResponse> {
    return await this.request(userInfoSpec, { uid: id })
  }

  /**
   * 获取用户详情
   */
  public async details(id: string): Promise<IUserDetailsResponse> {
    return await this.request(userDetailsSpec, { uid: id })
  }

  /**
   * 获取当前登录用户的详情（不带 uid 参数）。
   *
   * 该接口常用于会话自检：Cookie 过期/未登录时，通常会返回 `ok !== 1`。
   */
  public async myDetails(): Promise<IUserDetailsResponse> {
    return await this.request(myDetailsSpec, undefined, { skipPreflight: true })
  }

  /**
   * 获取用户详情信息，返回解析后的 User 类
   */
  public async getById(id: string): Promise<User> {
    const [info, details] = await Promise.all([
      this.info(id),
      this.details(id),
    ])

    const startAt = Date.now()
    const user = new User(info.data.user, details.data)
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: `${Date.now()}-normalize-user`,
      model: 'User',
      count: 1,
      duration_ms: Date.now() - startAt,
    })
    return user
  }
}
