import type { FavoritesResponse } from '../endpoints/favorite'
import type { IWeiboConfig } from '~/types/config'
import { favoritesSpec } from '../endpoints/favorite'
import { FetcherService } from '../internal/FetcherService'

export class FavoriteService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /** 获取收藏夹 GET /ajax/favorites/all_fav */
  public async getFavorites(uid: string, page?: number): Promise<FavoritesResponse> {
    const args: { uid: string, page?: number } = { uid }
    if (page !== undefined)
      args.page = page
    return await this.request(favoritesSpec, args)
  }
}
