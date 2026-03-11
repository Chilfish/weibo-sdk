import type { IRequestResource } from '../internal/FetcherService'
import type { IWeiboConfig } from '~/types/config'
import type { IMyMBlogResponse } from '~/types/raw/tweet/mymblog'
import type { IStatusShowResponse } from '~/types/raw/tweet/show'
import { Tweet } from '~/models/data/Tweet'
import { WeiboAPINotOkError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { getMessage, getOk, isRecord } from '~/utils/response'
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
    await this.emitFetched('TWEET_MYMBLOG', data, { endpoint: 'ajax/statuses/mymblog', request: resource, args: params })
    return data
  }

  /**
   * 获取并归一化微博列表（最小字段）
   */
  public async listByUserId(uid: string, sinceId?: number): Promise<TweetPageResult> {
    const raw = await this.myMblog(uid, sinceId)
    const nextSinceId = Number(raw.since_id ?? 0)
    return {
      sinceId: Number.isFinite(nextSinceId) ? nextSinceId : 0,
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

    const args = {
      id: mblogId,
      isGetLongText,
    } satisfies Record<string, unknown>

    const raw = await this.fetch<unknown>(resource, args)

    const ok = getOk(raw)
    if (ok !== 1) {
      const error = new WeiboAPINotOkError('Weibo API returned ok != 1 (statuses/show).', {
        endpoint: 'ajax/statuses/show',
        id: mblogId,
        ok,
        message: getMessage(raw),
        raw,
      })
      await this.emitError(error, {
        phase: 'response',
        endpoint: 'ajax/statuses/show',
        request: resource,
        args,
        ok,
        message: getMessage(raw),
        trace_id: this.newTraceId(),
        timestamp: Date.now(),
      })
      throw error
    }

    if (!isRecord(raw) || typeof raw.mblogid !== 'string' || !isRecord(raw.user)) {
      const error = new UnexpectedAPIResponseError('Weibo API response missing required fields (statuses/show).', {
        endpoint: 'ajax/statuses/show',
        id: mblogId,
        raw,
      })
      await this.emitError(error, {
        phase: 'parse',
        endpoint: 'ajax/statuses/show',
        request: resource,
        args,
        trace_id: this.newTraceId(),
        timestamp: Date.now(),
      })
      throw error
    }

    const data = raw as IStatusShowResponse
    await this.emitFetched('TWEET_SHOW', data, { endpoint: 'ajax/statuses/show', request: resource, args })
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
