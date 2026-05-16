import type { FollowContentResponse, FriendshipsResponse } from '../endpoints/follow'
import type { IWeiboConfig } from '~/types/config'
import { followContentSpec, friendshipsSpec } from '../endpoints/follow'
import { FetcherService } from '../internal/FetcherService'

export class FollowingsService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /** 获取用户关注列表 (cursor 分页) */
  public async getFollowings(uid: string, page?: number): Promise<FriendshipsResponse> {
    const args: { uid: string, page?: number } = { uid }
    if (page !== undefined)
      args.page = page
    return await this.request(friendshipsSpec, args)
  }

  /** 获取自己关注列表 (cursor 分页) */
  public async getMyFollowings(page?: number): Promise<FollowContentResponse> {
    const args: { page?: number } = {}
    if (page !== undefined)
      args.page = page
    return await this.request(followContentSpec, args)
  }
}
