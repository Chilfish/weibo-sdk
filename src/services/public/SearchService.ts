import type { SearchTweetsResponse, SearchUsersResponse } from '../endpoints/search'
import type { IWeiboConfig } from '~/types/config'
import { searchTweetsSpec, searchUsersSpec } from '../endpoints/search'
import { FetcherService } from '../internal/FetcherService'

export class SearchService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 搜索用户
   *
   * `GET https://m.weibo.cn/api/container/getIndex?containerid=100103type=3&q={query}&t=&page_type=searchall&page={page}`
   *
   * @param query 搜索关键词
   * @param page 分页（从 1 开始）
   */
  public async searchUsers(query: string, page?: number): Promise<SearchUsersResponse> {
    const args: { q: string, page?: number } = { q: query }
    if (typeof page === 'number')
      args.page = page
    return await this.request(searchUsersSpec, args)
  }

  /**
   * 搜索微博
   *
   * `GET https://m.weibo.cn/api/container/getIndex?containerid=100103type=1&q={query}&t=&page_type=searchall&page={page}`
   */
  public async searchTweets(query: string, page?: number): Promise<SearchTweetsResponse> {
    const args: { q: string, page?: number } = { q: query }
    if (typeof page === 'number')
      args.page = page
    return await this.request(searchTweetsSpec, args)
  }
}
