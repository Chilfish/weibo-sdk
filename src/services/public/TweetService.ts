import type { ZodType } from 'zod'
import type { EndpointSpec } from '../internal/EndpointSpec'
import type { IWeiboConfig } from '~/types/config'
import type { IMyMBlogResponse } from '~/types/raw/tweet/mymblog'
import type { IStatusShowResponse } from '~/types/raw/tweet/show'
import { z } from 'zod'
import { Tweet } from '~/models/data/Tweet'
import { FetcherService } from '../internal/FetcherService'

export interface TweetPageResult {
  sinceId: number
  tweets: Tweet[]
}

const MyMblogResponseSchema = z.object({
  since_id: z.number().optional(),
  list: z.array(z.unknown()).optional(),
  total: z.number().optional(),
}).passthrough() as unknown as ZodType<IMyMBlogResponse>

const IdSchema = z.union([z.string(), z.number()])

const StatusShowResponseSchema = z.object({
  ok: z.number(),
  id: IdSchema.optional(),
  idstr: z.string().optional(),
  mblogid: z.string(),
  created_at: z.string(),
  user: z.object({
    id: IdSchema.optional(),
    idstr: z.string().optional(),
  }).passthrough(),
}).passthrough().superRefine((val, ctx) => {
  if (val.id === undefined && !val.idstr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tweet.id or tweet.idstr is required',
      path: ['id'],
    })
  }
  if (val.user.id === undefined && !val.user.idstr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tweet.user.id or tweet.user.idstr is required',
      path: ['user', 'id'],
    })
  }
}) as unknown as ZodType<IStatusShowResponse>

interface MyMblogArgs { uid: string, since_id?: number }
interface StatusShowArgs { id: string, isGetLongText: boolean }

const myMblogSpec: EndpointSpec<'TWEET_MYMBLOG', MyMblogArgs> = {
  resourceType: 'TWEET_MYMBLOG',
  endpoint: 'ajax/statuses/mymblog',
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/mymblog',
    headers: {
      referer: `https://weibo.com/u/${uid}`,
    },
  }),
  okPolicy: { mode: 'none' },
  schema: MyMblogResponseSchema,
}

const statusShowSpec: EndpointSpec<'TWEET_SHOW', StatusShowArgs> = {
  resourceType: 'TWEET_SHOW',
  endpoint: 'ajax/statuses/show',
  buildResource: ({ id }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/statuses/show',
    headers: {
      referer: `https://weibo.com/detail/${id}`,
    },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: StatusShowResponseSchema,
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
    const args: MyMblogArgs = { uid }
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
    return await this.request(statusShowSpec, { id: mblogId, isGetLongText })
  }

  /**
   * 获取并归一化单条微博详情
   */
  public async getByMblogId(mblogId: string, isGetLongText: boolean = true): Promise<Tweet> {
    const raw = await this.show(mblogId, isGetLongText)
    return new Tweet(raw)
  }
}
