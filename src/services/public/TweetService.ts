import type { IWeiboConfig } from '~/types/config'
import type { IMyMBlogResponse } from '~/types/raw/tweet/mymblog'
import type { IStatusShowResponse } from '~/types/raw/tweet/show'
import { Tweet } from '~/models/data/Tweet'
import { FetcherService } from '../internal/FetcherService'
import { myMblogSpec, statusShowSpec } from '../endpoints/tweet'

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
    const args: { uid: string, since_id?: number } = { uid }
    if (typeof sinceId === 'number')
      args.since_id = sinceId
    return await this.request(myMblogSpec, args)
  }

  /**
   * 获取并归一化微博列表（最小字段）
   */
  public async listByUserId(uid: string, sinceId?: number): Promise<TweetPageResult> {
    const raw = await this.myMblog(uid, sinceId)
    const nextSinceId = Number(raw.since_id ?? 0)
    const startAt = Date.now()
    const tweets = (raw.list || []).map(item => new Tweet(item))
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: `${Date.now()}-normalize-tweet-list`,
      model: 'Tweet',
      count: tweets.length,
      duration_ms: Date.now() - startAt,
    })
    return {
      sinceId: Number.isFinite(nextSinceId) ? nextSinceId : 0,
      tweets,
    }
  }

  /**
   * 获取单条微博详情
   *
   * `GET https://weibo.com/ajax/statuses/show?id=${mblogid}&isGetLongText=true`
   */
  public async show(mblogId: string, isGetLongText: boolean = true): Promise<IStatusShowResponse> {
    return await this.request(statusShowSpec, { id: mblogId, isGetLongText })
  }

  /**
   * 获取并归一化单条微博详情
   */
  public async getByMblogId(mblogId: string, isGetLongText: boolean = true): Promise<Tweet> {
    const raw = await this.show(mblogId, isGetLongText)
    const startAt = Date.now()
    const tweet = new Tweet(raw)
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: `${Date.now()}-normalize-tweet`,
      model: 'Tweet',
      count: 1,
      duration_ms: Date.now() - startAt,
    })
    return tweet
  }
}
