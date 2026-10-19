import type { FollowContentResponse, FriendshipsResponse } from '../endpoints/follow'
import type { IWeiboConfig } from '~/types/config'
import { followContentSpec, friendshipsSpec } from '../endpoints/follow'
import { FetcherService } from '../internal/FetcherService'

/**
 * 关注关系领域服务。
 *
 * 覆盖三条路径：指定用户的关注列表、指定用户的粉丝列表、当前登录用户自己的关注列表
 * （后者走上游 `followContent`，分页语义与 friendships 略有差异）。
 */
export class FollowingsService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取用户关注列表 (cursor 分页)
   *
   * @param uid 目标用户 UID
   * @param page 页码（从 1 开始；缺省 = 第一页）
   * @returns 校验后的 friendships 响应（`data.users` 为用户数组，含 `next_cursor`）
   */
  public async getFollowings(uid: string, page?: number): Promise<FriendshipsResponse> {
    const args: { uid: string, page?: number } = { uid }
    if (page !== undefined)
      args.page = page
    return await this.request(friendshipsSpec, args)
  }

  /**
   * 获取用户粉丝列表 (relate=fans, cursor 分页)
   *
   * @param uid 目标用户 UID
   * @param page 页码（从 1 开始；缺省 = 第一页）
   * @returns 校验后的 friendships 响应（`data.users` 为粉丝数组）
   */
  public async getFans(uid: string, page?: number): Promise<FriendshipsResponse> {
    const args: { uid: string, relate: 'fans', page?: number } = { uid, relate: 'fans' }
    if (page !== undefined)
      args.page = page
    return await this.request(friendshipsSpec, args)
  }

  /**
   * 获取自己关注列表 (cursor 分页)
   *
   * 说明：不需要 uid，使用当前 Cookie 的登录用户；响应结构与 `getFollowings` 不同（走 followContent 端点）。
   *
   * @param page 页码（从 1 开始；缺省 = 第一页）
   * @returns 校验后的 `followContent` 响应（`data.list` 为关注关系条目）
   */
  public async getMyFollowings(page?: number): Promise<FollowContentResponse> {
    const args: { page?: number } = {}
    if (page !== undefined)
      args.page = page
    return await this.request(followContentSpec, args)
  }
}
