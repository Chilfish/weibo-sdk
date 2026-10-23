import type { SearchTweetsResponse, SearchUsersResponse } from '../endpoints/search'
import type { RawTweet } from '~/models/data/Tweet'
import type { IWeiboConfig } from '~/types/config'
import type { ITweet } from '~/types/domain/ITweet'
import type { UserBrief } from '~/types/domain/IUser'
import { Tweet } from '~/models/data/Tweet'
import { normalizeUserBrief } from '~/models/data/User'
import { midToMblogId } from '~/utils/tweetId'
import { searchTweetsSpec, searchUsersSpec } from '../endpoints/search'
import { FetcherService } from '../internal/FetcherService'

type UnknownRecord = Record<string, unknown>

/** 一页用户搜索结果（`searchUsers` 返回值）。 */
export interface SearchUserPageResult {
  /** 本页归一化用户（已按 id 去重） */
  users: UserBrief[]
  /** 本次请求的页码 */
  page: number
  /** 上游报告的总数 */
  total?: number
  /** 是否可能还有下一页 */
  hasMore: boolean
}

/** 一页微博搜索结果（`searchTweets` 返回值）。 */
export interface SearchTweetPageResult {
  /** 本页归一化微博 */
  tweets: ITweet[]
  /** 本次请求的页码 */
  page: number
  /** 上游报告的总数 */
  total?: number
  /** 是否可能还有下一页 */
  hasMore: boolean
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pageOf(page: number | undefined): number {
  return page !== undefined && Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1
}

function collectUsers(raw: SearchUsersResponse): UserBrief[] {
  const users: UserBrief[] = []
  const seen = new Set<string>()

  for (const card of raw.data.cards) {
    for (const group of card.card_group ?? []) {
      if (!group.user)
        continue
      const user = normalizeUserBrief(group.user)
      if (user.id === '' || seen.has(user.id))
        continue
      seen.add(user.id)
      users.push(user)
    }
  }
  return users
}

function collectTweets(raw: SearchTweetsResponse): ITweet[] {
  const tweets: ITweet[] = []
  const seen = new Set<string>()

  const push = (mblog: UnknownRecord): void => {
    const record: UnknownRecord = { ...mblog }
    if (typeof record.mblogid !== 'string' || record.mblogid === '') {
      const id = typeof record.mid === 'string' || typeof record.mid === 'number'
        ? String(record.mid)
        : typeof record.id === 'string' || typeof record.id === 'number'
          ? String(record.id)
          : undefined
      if (id === undefined)
        return
      const mblogid = midToMblogId(id)
      if (mblogid === '')
        return
      record.mblogid = mblogid
    }
    const tweet = new Tweet(record as RawTweet)
    if (seen.has(tweet.mblogId))
      return
    seen.add(tweet.mblogId)
    tweets.push(tweet)
  }

  for (const card of raw.data.cards) {
    if (card.mblog)
      push(card.mblog)
    for (const group of card.card_group ?? []) {
      if (isRecord(group) && isRecord(group.mblog))
        push(group.mblog)
    }
  }
  return tweets
}

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
   * 拉取用户搜索原始响应（低层数据源，公开使用请走 `searchUsers`）
   *
   * ⚠️ 上游接口已失效（2026-08 实测）：m.weibo.cn wap 需独立登录态（weibo.com cookie 不适用），
   * 且微博已移除公开 JSON 搜索 API。本方法当前对真实调用通常抛错，属 known-issue。
   */
  public async fetchRawSearchUsers(query: string, page?: number): Promise<SearchUsersResponse> {
    const args: { q: string, page?: number } = { q: query }
    if (typeof page === 'number')
      args.page = page
    return await this.request(searchUsersSpec, args)
  }

  /**
   * 拉取微博搜索原始响应（低层数据源，公开使用请走 `searchTweets`）
   *
   * ⚠️ 失效状态同 `fetchRawSearchUsers`（known-issue，见 backlog）。
   */
  public async fetchRawSearchTweets(query: string, page?: number): Promise<SearchTweetsResponse> {
    const args: { q: string, page?: number } = { q: query }
    if (typeof page === 'number')
      args.page = page
    return await this.request(searchTweetsSpec, args)
  }

  /**
   * 搜索用户（归一化）
   *
   * ⚠️ **上游接口已失效（2026-08 实测）**：m.weibo.cn wap 需独立登录态（weibo.com cookie 不适用），
   * 且微博已移除公开 JSON 搜索 API。本方法当前对真实调用会抛 `UnexpectedAPIResponseError`。
   *
   * @param query 搜索关键词
   * @param page 分页（从 1 开始）
   * @returns 归一化用户 + 总数 + 下一页判断（fixture 回放可用；真实调用通常抛错）
   */
  public async searchUsers(query: string, page?: number): Promise<SearchUserPageResult> {
    const raw = await this.fetchRawSearchUsers(query, page)
    const users = collectUsers(raw)
    const current = pageOf(page)
    const total = raw.data.cardlistInfo?.total
    const result: SearchUserPageResult = {
      users,
      page: current,
      hasMore: users.length > 0 && (total === undefined || current * users.length < total),
    }
    if (total !== undefined)
      result.total = total
    return result
  }

  /**
   * 搜索微博（归一化）
   *
   * ⚠️ 失效状态同 `searchUsers`（known-issue，见 backlog）。
   *
   * @param query 搜索关键词
   * @param page 分页（从 1 开始）
   * @returns 归一化微博 + 总数 + 下一页判断（fixture 回放可用；真实调用通常抛错）
   */
  public async searchTweets(query: string, page?: number): Promise<SearchTweetPageResult> {
    const raw = await this.fetchRawSearchTweets(query, page)
    const tweets = collectTweets(raw)
    const current = pageOf(page)
    const total = raw.data.cardlistInfo?.total
    const result: SearchTweetPageResult = {
      tweets,
      page: current,
      hasMore: tweets.length > 0 && (total === undefined || current * tweets.length < total),
    }
    if (total !== undefined)
      result.total = total
    return result
  }
}
