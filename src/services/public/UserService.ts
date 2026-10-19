import type { UserDetailsResponse, UserInfoResponse } from '../endpoints/user'
import type { IWeiboConfig } from '~/types/config'
import { User } from '~/models/data/User'
import { myDetailsSpec, userDetailsSpec, userInfoSpec } from '../endpoints/user'
import { FetcherService } from '../internal/FetcherService'

let normalizeSeq = 0

/**
 * 用户领域服务。
 *
 * 同时提供 raw 路径（`info` / `details`，已 deprecated）与归一化路径（`getById`）；
 * 归一化路径会并行拉取 info + detail 两份 raw，再交给 `User` 归一化。
 *
 * 继承 `FetcherService`：自动处理 Cookie 注入、限流、hooks 与 Wide Events，
 * 失败时抛出 `WeiboSDKError` 子类（`WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误）。
 */
export class UserService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
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
   * @param id 用户ID (uid)
   * @returns 未校验（passthrough）的 `ajax/profile/detail` 响应，含上游新增字段
   * @deprecated F2 生熟双 API 收窄：公开使用请走归一化路径 `getById`
   */
  public async details(id: string): Promise<UserDetailsResponse> {
    return await this.request(userDetailsSpec, { uid: id })
  }

  /**
   * 获取当前登录用户的详情（不带 uid 参数）。
   *
   * 该接口常用于会话自检：Cookie 过期/未登录时，通常会返回 `ok !== 1`。
   *
   * 说明：内部以 `skipPreflight` 发出，避免自检请求反过来触发 SDK 自身的 lazy 自检。
   *
   * @throws `WeiboSessionExpiredError`（登录态缺失）或 `WeiboAPINotOkError` 等业务错误
   */
  public async myDetails(): Promise<UserDetailsResponse> {
    return await this.request(myDetailsSpec, {}, { skipPreflight: true })
  }

  /**
   * 获取用户详情信息，返回解析后的 User 类
   *
   * 实现：并行请求 `info` 与 `details`，两者都成功后按 fallback 链归一化，
   * 并发出 `normalize_done` Wide Event（`model: 'User'`）。
   *
   * @param id 用户 UID（数字串或 `idstr`）
   * @returns 归一化后的 `User` 实例（缺失字段为 `undefined`，不伪造默认值）
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误（任一请求失败即整体失败）
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
