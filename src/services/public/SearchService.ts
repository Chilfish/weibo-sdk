import type { IWeiboConfig } from '~/types/config'
import type { ISearchTweetsResponse, ISearchUsersResponse } from '~/types/raw/search/search'
import { searchTweetsSpec, searchUsersSpec } from '../endpoints/search'
import { FetcherService } from '../internal/FetcherService'

export class SearchService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 搜索用户
   *
   * `GET https://weibo.com/ajax/search/users?q={query}&page={page}`
   */
  public async searchUsers(query: string, page?: number): Promise<ISearchUsersResponse> {
    const args: { q: string, page?: number } = { q: query }
    if (typeof page === 'number')
      args.page = page
    return await this.request(searchUsersSpec, args)
  }

  /**
   * 搜索微博
   *
   * `GET https://weibo.com/ajax/search/tweets?q={query}&page={page}`
   */
  public async searchTweets(query: string, page?: number): Promise<ISearchTweetsResponse> {
    const args: { q: string, page?: number } = { q: query }
    if (typeof page === 'number')
      args.page = page
    return await this.request(searchTweetsSpec, args)
  }
}
