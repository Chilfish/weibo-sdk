import type { FavoritesResponse, FavoritesTagsResponse } from '../endpoints/favorite'
import type { IWeiboConfig } from '~/types/config'
import { favoritesSpec, favoritesTagsSpec } from '../endpoints/favorite'
import { FetcherService } from '../internal/FetcherService'

/**
 * 收藏领域服务。
 *
 * 提供收藏夹内容（page 分页）与收藏标签读取；`ArchiveService` 的 favorites 阶段
 * 依赖 `getFavorites` 拉取收藏微博。
 */
export class FavoriteService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取收藏夹 GET /ajax/favorites/all_fav
   *
   * 内部固定 `with_total=true`：否则 `data` 返回裸数组而非 `{ status: [...] }` 对象，schema 校验会失败。
   *
   * @param uid 收藏所属用户 UID
   * @param page 页码（从 1 开始；缺省 = 第一页）
   * @returns 校验后的收藏响应，`data.status` 为收藏微博数组、`data.total_number` 为总数
   */
  public async getFavorites(uid: string, page?: number): Promise<FavoritesResponse> {
    // with_total=true 让 data 返回 { status: [...] } 对象结构（否则是裸数组，schema 校验失败）
    const args: { uid: string, page?: number, with_total: boolean } = { uid, with_total: true }
    if (page !== undefined)
      args.page = page
    return await this.request(favoritesSpec, args)
  }

  /**
   * 获取收藏夹标签 GET /ajax/favorites/tags
   *
   * @returns 校验后的标签响应（标签列表用于 CLI / 下游按分类浏览收藏）
   */
  public async getTags(): Promise<FavoritesTagsResponse> {
    return await this.request(favoritesTagsSpec, {})
  }
}
