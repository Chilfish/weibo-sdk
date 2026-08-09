import type { FavoritesResponse, FavoritesTagsResponse } from '../endpoints/favorite'
import type { IWeiboConfig } from '~/types/config'
import { favoritesSpec, favoritesTagsSpec } from '../endpoints/favorite'
import { FetcherService } from '../internal/FetcherService'

export class FavoriteService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /** 获取收藏夹 GET /ajax/favorites/all_fav */
  public async getFavorites(uid: string, page?: number): Promise<FavoritesResponse> {
    // with_total=true 让 data 返回 { status: [...] } 对象结构（否则是裸数组，schema 校验失败）
    const args: { uid: string, page?: number, with_total: boolean } = { uid, with_total: true }
    if (page !== undefined)
      args.page = page
    return await this.request(favoritesSpec, args)
  }

  /** 获取收藏夹标签 GET /ajax/favorites/tags */
  public async getTags(): Promise<FavoritesTagsResponse> {
    return await this.request(favoritesTagsSpec, {})
  }
}
