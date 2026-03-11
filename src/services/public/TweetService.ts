import type { IRequestResource } from '../internal/FetcherService'
import type { IWeiboConfig } from '~/types/config'
import type { IMyMBlogResponse } from '~/types/raw/tweet/mymblog'
import type { IStatusShowResponse } from '~/types/raw/tweet/show'
import { Tweet } from '~/models/data/Tweet'
import { FetcherService } from '../internal/FetcherService'

export interface TweetPageResult {
  sinceId: number
  tweets: Tweet[]
}

export class TweetService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取用户微博列表（mymblog）
   *
   * 说明：这是最小可用实现，后续需要补齐分页参数、置顶/广告过滤、长文/转发解析等规则。
   */
  public async myMblog(uid: string, sinceId?: number): Promise<IMyMBlogResponse> {
    const resource: IRequestResource = {
      method: 'GET',
      url: 'https://weibo.com/ajax/statuses/mymblog',
      headers: {
        referer: `https://weibo.com/u/${uid}`,
      },
    }

    const params: Record<string, unknown> = { uid }
    if (typeof sinceId === 'number')
      params.since_id = sinceId

    const data = await this.fetch<IMyMBlogResponse>(resource, params)
    await this.onFetched('TWEET_MYMBLOG', data)
    return data
  }

  /**
   * 获取并归一化微博列表（最小字段）
   */
  public async listByUserId(uid: string, sinceId?: number): Promise<TweetPageResult> {
    const raw = await this.myMblog(uid, sinceId)
    return {
      sinceId: raw.since_id,
      tweets: (raw.list || []).map(item => new Tweet(item)),
    }
  }

  /**
   * 获取单条微博详情
   *
   * `GET https://weibo.com/ajax/statuses/show?id=${mblogid}&isGetLongText=true`
   */
  public async show(mblogId: string, isGetLongText: boolean = true): Promise<IStatusShowResponse> {
    const resource: IRequestResource = {
      method: 'GET',
      url: 'https://weibo.com/ajax/statuses/show',
      headers: {
        referer: `https://weibo.com/detail/${mblogId}`,
      },
    }

    const data = await this.fetch<IStatusShowResponse>(resource, {
      id: mblogId,
      isGetLongText,
    })

    await this.onFetched('TWEET_SHOW', data)
    return data
  }

  /**
   * 获取并归一化单条微博详情
   */
  public async getByMblogId(mblogId: string, isGetLongText: boolean = true): Promise<Tweet> {
    const raw = await this.show(mblogId, isGetLongText)
    return new Tweet(raw)
  }
}
