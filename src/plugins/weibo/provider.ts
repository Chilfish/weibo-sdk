import type { CrawlerContext } from '~/core/context'
import type { ISNSProvider } from '~/types/core'
import type { Actor, UnifiedPost } from '~/types/model'
import { FETCH_PATH, WEIBO_BASE_URL } from './constants'
import { WeiboParser } from './parser'

export class WeiboProvider implements ISNSProvider {
  readonly platformName = 'weibo'
  private parser: WeiboParser

  constructor(private context: CrawlerContext) {
    this.parser = new WeiboParser()
  }

  public hasCapability(capability: string): boolean {
    return ['user_feed', 'search', 'get_profile'].includes(capability)
  }

  /**
   * 构建请求头：合并 默认配置 + 平台配置 (Cookie) + 动态 Referer
   */
  private getRequestOptions(refererPath: string = ''):  {
     headers: Record<string, string>;
 } {
    const platformConfig = this.context.getPlatformConfig('weibo')

    const headers: Record<string, string> = {
      // 微博风控强依赖 Referer
      'Referer': `https://weibo.com${refererPath}`,
      'X-Requested-With': 'XMLHttpRequest',
      ...platformConfig.headers, // 允许用户覆盖
    }
    // 注入 Cookie
    if (platformConfig.cookie) {
      headers.Cookie = platformConfig.cookie
    }
    // 某些 API 可能需要特定的 UA，这里也可以覆盖
    return { headers }
  }

  public async getProfile(userId: string): Promise<Actor> {
    this.context.logger.info(`Fetching Weibo profile for: ${userId}`)
    // 使用封装好的 getRequestOptions
    const options = this.getRequestOptions(`/u/${userId}`)
    const [baseRes, detailRes] = await Promise.allSettled([
      this.context.http.get(`${WEIBO_BASE_URL}${FETCH_PATH.PROFILE_INFO}`, {
        params: { uid: userId },
        ...options,
      }),
      this.context.http.get(`${WEIBO_BASE_URL}${FETCH_PATH.PROFILE_DETAIL}`, {
        params: { uid: userId },
        ...options,
      }),
    ])
    if (baseRes.status === 'rejected') {
      // 打印更详细的错误，Axios 错误通常在 message 里
      this.context.logger.error(`API Error: ${baseRes.reason.message}`)
      throw baseRes.reason
    }
    const rawUser = this.parser.validateUser(baseRes.value.data.data.user)

    // ... (后续解析逻辑与之前相同，略)
    let rawDetail
    if (detailRes.status === 'fulfilled' && detailRes.value.data?.data) {
      rawDetail = detailRes.value.data.data
    }
    const actor = this.parser.toActor(rawUser, rawDetail)
    this.context.logger.info(`Successfully fetched actor: ${actor.displayName}`)

    return actor
  }

  // --- 占位实现其他接口 (将在后续完善) ---

  public async getPost(postId: string): Promise<UnifiedPost> {
    throw new Error('Method not implemented.')
  }

  public async* getUserFeedStream(userId: string): AsyncIterableIterator<UnifiedPost> {
    // 下一步实现：User Feed logic
    yield {} as any
  }
}
