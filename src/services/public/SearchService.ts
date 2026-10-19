import type { SearchTweetsResponse, SearchUsersResponse } from '../endpoints/search'
import type { IWeiboConfig } from '~/types/config'
import { searchTweetsSpec, searchUsersSpec } from '../endpoints/search'
import { FetcherService } from '../internal/FetcherService'

/**
 * 搜索领域服务（用户 / 微博）。
 *
 * ⚠️ 当前为 **known-issue**：微博已移除公开 JSON 搜索 API，两个方法对真实调用都会失败
 * （详见各方法注释与 `docs/planning/backlog.md`），保留接口仅为契约稳定与 fixture 回放能力。
 */
export class SearchService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 搜索用户
   *
   * `GET https://m.weibo.cn/api/container/getIndex?containerid=100103type=3&q={query}&t=&page_type=searchall&page={page}`
   *
   * ⚠️ **上游接口已失效（2026-08 实测）**：m.weibo.cn wap 需独立登录态（weibo.com cookie 不适用），
   * 且微博已移除公开 JSON 搜索 API（s.weibo.com 为服务端渲染 HTML，weibo.com/ajax/search/* 返回登录页）。
   * 本方法当前对真实调用会抛 `UnexpectedAPIResponseError`（响应非 JSON），属 known-issue，见 docs/planning/backlog.md。
   *
   * @param query 搜索关键词
   * @param page 分页（从 1 开始）
   * @returns 校验后的搜索响应（可用于 fixture 回放；真实调用通常抛错）
   * @throws `UnexpectedAPIResponseError` 上游返回 HTML 登录页 / 非 JSON（当前真实调用的常态）
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
   *
   * ⚠️ 失效状态同 `searchUsers`（known-issue，见 backlog）。
   *
   * @param query 搜索关键词
   * @param page 分页（从 1 开始）
   * @returns 校验后的搜索响应（可用于 fixture 回放；真实调用通常抛错）
   * @throws `UnexpectedAPIResponseError` 上游返回 HTML 登录页 / 非 JSON（当前真实调用的常态）
   */
  public async searchTweets(query: string, page?: number): Promise<SearchTweetsResponse> {
    const args: { q: string, page?: number } = { q: query }
    if (typeof page === 'number')
      args.page = page
    return await this.request(searchTweetsSpec, args)
  }
}
