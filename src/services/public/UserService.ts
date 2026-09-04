import type { UserDetailsResponse, UserInfoResponse } from '../endpoints/user'
import type { IWeiboConfig } from '~/types/config'
import { User } from '~/models/data/User'
import { myDetailsSpec, userDetailsSpec, userInfoSpec } from '../endpoints/user'
import { FetcherService } from '../internal/FetcherService'

let normalizeSeq = 0

export class UserService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取用户信息（raw 响应）
   * @param id 用户ID (uid)
   * @deprecated F2 生熟双 API 收窄：公开使用请走归一化路径 `getById`
   */
  public async info(id: string): Promise<UserInfoResponse> {
    return await this.request(userInfoSpec, { uid: id })
  }

  /**
   * 获取用户详情（raw 响应）
   * @deprecated F2 生熟双 API 收窄：公开使用请走归一化路径 `getById`
   */
  public async details(id: string): Promise<UserDetailsResponse> {
    return await this.request(userDetailsSpec, { uid: id })
  }

  /**
   * 获取当前登录用户的详情（不带 uid 参数）。
   *
   * 该接口常用于会话自检：Cookie 过期/未登录时，通常会返回 `ok !== 1`。
   */
  public async myDetails(): Promise<UserDetailsResponse> {
    return await this.request(myDetailsSpec, {}, { skipPreflight: true })
  }

  /**
   * 获取用户详情信息，返回解析后的 User 类
   */
  public async getById(id: string): Promise<User> {
    const traceId = `${Date.now()}-getById-${++normalizeSeq}`
    const [info, details] = await Promise.all([
      this.info(id),
      this.details(id),
    ])

    const startAt = Date.now()
    const user = new User(info.data.user as any, details.data as any)
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'User',
      count: 1,
      duration_ms: Date.now() - startAt,
    })
    return user
  }
}
