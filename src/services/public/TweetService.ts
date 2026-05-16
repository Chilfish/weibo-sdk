import type { MyMblogResponse, StatusShowResponse } from '../endpoints/tweet'
import type { IWeiboConfig } from '~/types/config'
import type { MyMBLog } from '~/types/raw/tweet/mymblog'
import { Tweet } from '~/models/data/Tweet'
import { myMblogSpec, statusShowSpec } from '../endpoints/tweet'
import { FetcherService } from '../internal/FetcherService'

let normalizeSeq = 0

export interface TweetPageResult {
  sinceId: number
  hasMore: boolean
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
  public async myMblog(uid: string, sinceId?: number, count?: number): Promise<MyMblogResponse> {
    const args: { uid: string, since_id?: number, count?: number } = { uid }
    if (typeof sinceId === 'number')
      args.since_id = sinceId
    if (typeof count === 'number')
      args.count = count
    return await this.request(myMblogSpec, args)
  }

  /**
   * 过滤掉广告等无效微博
   */
  private filterTweets(rawList: MyMBLog[]): MyMBLog[] {
    return rawList.filter(item => !item.isAd)
  }

  /**
   * 获取并归一化微博列表（最小字段）
   *
   * 支持两种调用方式：
   * - `listByUserId(uid, sinceId?)` —— 旧签名，兼容
   * - `listByUserId(uid, { sinceId?, count? })` —— 新签名，支持分页数
   */
  public async listByUserId(uid: string, sinceId?: number): Promise<TweetPageResult>
  public async listByUserId(uid: string, options?: { sinceId?: number, count?: number }): Promise<TweetPageResult>
  public async listByUserId(uid: string, sinceIdOrOptions?: number | { sinceId?: number, count?: number }): Promise<TweetPageResult> {
    let sinceId: number | undefined
    let count: number | undefined

    if (typeof sinceIdOrOptions === 'object') {
      sinceId = sinceIdOrOptions?.sinceId
      count = sinceIdOrOptions?.count
    }
    else {
      sinceId = sinceIdOrOptions
    }

    const traceId = `${Date.now()}-listByUserId-${++normalizeSeq}`
    const raw = await this.myMblog(uid, sinceId, count)
    const nextSinceId = Number(raw.since_id ?? 0)
    const filtered = this.filterTweets(raw.list || [])
    const hasMore = typeof raw.since_id === 'string' && raw.since_id.length > 0
      && raw.total > 0
      && filtered.length < raw.total
    const startAt = Date.now()
    const tweets = filtered.map(item => new Tweet(item))
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'Tweet',
      count: tweets.length,
      duration_ms: Date.now() - startAt,
    })
    return {
      sinceId: Number.isFinite(nextSinceId) ? nextSinceId : 0,
      hasMore,
      tweets,
    }
  }

  /**
   * 获取单条微博详情
   *
   * `GET https://weibo.com/ajax/statuses/show?id=${mblogid}&isGetLongText=true`
   */
  public async show(mblogId: string, isGetLongText: boolean = true): Promise<StatusShowResponse> {
    return await this.request(statusShowSpec, { id: mblogId, isGetLongText })
  }

  /**
   * 获取并归一化单条微博详情
   */
  public async getByMblogId(mblogId: string, isGetLongText: boolean = true): Promise<Tweet> {
    const traceId = `${Date.now()}-getByMblogId-${++normalizeSeq}`
    const raw = await this.show(mblogId, isGetLongText)
    const startAt = Date.now()
    const tweet = new Tweet(raw)
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'Tweet',
      count: 1,
      duration_ms: Date.now() - startAt,
    })
    return tweet
  }
}
