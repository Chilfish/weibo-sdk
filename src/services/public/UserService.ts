import type { MentionsViewArgs } from '../endpoints/mentions'
import type { UserDetailsResponse, UserInfoResponse } from '../endpoints/user'
import type { IWeiboConfig } from '~/types/config'
import type { MblogGroup, UserGroup } from '~/types/domain/IGroup'
import type { ITweet } from '~/types/domain/ITweet'
import type { ISelfProfile, IUser } from '~/types/domain/IUser'
import type { StreamRangeOptions } from '~/utils/streamRange'
import { normalizeMblogGroups, normalizeUserGroups } from '~/models/data/Group'
import { Tweet as TweetModel } from '~/models/data/Tweet'
import { normalizeSelfProfile, User } from '~/models/data/User'
import { createStreamRange } from '~/utils/streamRange'
import { feedGroupsSpec, mblogGroupsSpec } from '../endpoints/groups'
import { mentionsSpec } from '../endpoints/mentions'
import { myDetailsSpec, userDetailsSpec, userInfoSpec } from '../endpoints/user'
import { FetcherService } from '../internal/FetcherService'

let normalizeSeq = 0

/** 一页 `@我的微博`（`listMentions` 返回值）。 */
export interface UserMentionsPageResult {
  /** 下一页游标（上游 `data.next_cursor`；`0` 表示到底） */
  cursor: number
  /** 是否可能还有下一页（`cursor !== 0` 且本页非空） */
  hasMore: boolean
  /** 上游 `total_number`（可用时） */
  total?: number
  /** 本页归一化微博（已按 `mblogid` 去重） */
  tweets: ITweet[]
}

/** `listMentions` 的选项。 */
export interface UserMentionsListOptions {
  /** 游标：上一页返回的 `cursor`（上游参数名 `max_id`）；优先于 `page` */
  maxId?: number | string
  /** 页码（1 基，缺省 = 第一页）；仅在未给 `maxId` 时生效 */
  page?: number
}

/** @提及流进度（每页触发一次）。 */
export interface UserMentionsStreamProgress {
  /** 本页返回的下一页游标 */
  cursor: number
  /** 本次请求的页码（1 基，按请求轮次递增） */
  page: number
  /** 已产出的微博数（跨页去重后） */
  processed: number
  /** 本页去重前的条数 */
  pageSize: number
  /** 上游 `total_number`（可用时） */
  total?: number
}

/** `streamMentions` 的选项。 */
export interface UserMentionsStreamOptions extends UserMentionsListOptions, StreamRangeOptions {
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；回调抛错不会中断流 */
  onProgress?: (progress: UserMentionsStreamProgress) => void | Promise<void>
}

/** `max_id` 归一化：接受正有限数或数字字符串，其余按「未指定」处理。 */
function normalizeMaxId(maxId?: number | string): number | undefined {
  if (maxId === undefined || maxId === null)
    return undefined
  const parsed = typeof maxId === 'number'
    ? maxId
    : typeof maxId === 'string' && maxId.trim() !== ''
      ? Number(maxId)
      : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** 页码归一化：只接受 >= 1 的有限数；其余按「未指定」处理。 */
function normalizePage(page?: number): number | undefined {
  if (page === undefined || !Number.isFinite(page))
    return undefined
  const normalized = Math.floor(page)
  return normalized >= 1 ? normalized : undefined
}

/** 翻页上限归一化：缺省 / 非有限数 = 不限；其余取非负整数。 */
function normalizeMaxPages(maxPages?: number): number {
  if (maxPages === undefined || !Number.isFinite(maxPages))
    return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(maxPages))
}

/** 游标解析：上游 `next_cursor` 声明为 number | string；非法值按 `0`（到底）处理。 */
function parseCursor(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

/** `total_number` 实测可能缺失或为异常值；只接受有限的非负数。 */
function parseTotal(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : undefined
  return parsed !== undefined && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/** 组装 `mentions` 参数：`max_id` 优先，其次 `page`，都不给则首屏。 */
function buildMentionArgs(options: UserMentionsListOptions): MentionsViewArgs {
  const maxId = normalizeMaxId(options.maxId)
  if (maxId !== undefined)
    return { max_id: maxId }
  const page = normalizePage(options.page)
  return page !== undefined ? { page } : {}
}

/**
 * 用户领域服务。
 *
 * 公开面走归一化路径 `getById`；`fetchRawInfo` / `fetchRawDetails` 是低层 raw 数据源，
 * 供 hooks、归档与 schema 快照使用。
 *
 * 继承 `FetcherService`：自动处理 Cookie 注入、限流、hooks 与 Wide Events，
 * 失败时抛出 `WeiboSDKError` 子类（`WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误）。
 */
export class UserService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 拉取用户信息原始响应（低层数据源，公开使用请走 `getById`）
   * @param id 用户ID (uid)
   */
  public async fetchRawInfo(id: string): Promise<UserInfoResponse> {
    return await this.request(userInfoSpec, { uid: id })
  }

  /**
   * 拉取用户详情原始响应（低层数据源，公开使用请走 `getById`）
   * @param id 用户ID (uid)
   * @returns 未校验（passthrough）的 `ajax/profile/detail` 响应，含上游新增字段
   */
  public async fetchRawDetails(id: string): Promise<UserDetailsResponse> {
    return await this.request(userDetailsSpec, { uid: id })
  }

  /**
   * 获取当前登录用户的详情（不带 uid 参数）。
   *
   * 该接口常用于会话自检：Cookie 过期/未登录时，通常会返回 `ok !== 1`。
   *
   * 说明：内部以 `skipPreflight` 发出，避免自检请求反过来触发 SDK 自身的 lazy 自检。
   *
   * @throws `WeiboSessionExpiredError`（登录态缺失）或 `WeiboAPINotOkError` 等业务错误
   */
  public async fetchRawMyDetails(): Promise<UserDetailsResponse> {
    return await this.request(myDetailsSpec, {}, { skipPreflight: true })
  }

  /**
   * 获取当前登录用户的资料（归一化）。
   *
   * 该端点只返回详情侧字段（IP 属地 / 教育 / 公司 / 标签等），不含昵称、头像与计数；
   * 完整资料请用 `getById(uid)`，`uid` 可从返回值的 `uid` 字段取得。
   */
  public async myDetails(): Promise<ISelfProfile> {
    return normalizeSelfProfile((await this.fetchRawMyDetails()).data)
  }

  /**
   * 获取用户详情信息，返回解析后的 User 类
   *
   * 实现：并行请求 `fetchRawInfo` 与 `fetchRawDetails`，两者都成功后按 fallback 链归一化，
   * 并发出 `normalize_done` Wide Event（`model: 'User'`）。
   *
   * @param id 用户 UID（数字串或 `idstr`）
   * @returns 归一化后的 `IUser`（缺失字段为 `undefined`，不伪造默认值）
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误（任一请求失败即整体失败）
   */
  public async getById(id: string): Promise<IUser> {
    const traceId = `${Date.now()}-getById-${++normalizeSeq}`
    const [info, details] = await Promise.all([
      this.fetchRawInfo(id),
      this.fetchRawDetails(id),
    ])

    const startAt = Date.now()
    const user = new User(info.data.user, details.data)
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'User',
      count: 1,
      duration_ms: Date.now() - startAt,
    })
    return user
  }

  /**
   * 获取一页 `@我的微博`（D9）。
   *
   * `GET /ajax/statuses/mentions`：`max_id` 与 `page` 等价，`since_id` 被上游忽略。
   *
   * @param options 分页选项（`maxId` 优先于 `page`）
   * @returns 归一化微博 + 下一页游标
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async listMentions(options: UserMentionsListOptions = {}): Promise<UserMentionsPageResult> {
    const startAt = Date.now()
    const page = await this.fetchMentionPage(options)
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'Tweet',
      count: page.tweets.length,
      duration_ms: Date.now() - startAt,
    })

    const result: UserMentionsPageResult = {
      cursor: page.cursor,
      hasMore: page.cursor !== 0 && page.tweets.length > 0,
      tweets: page.tweets,
    }
    if (page.total !== undefined)
      result.total = page.total
    return result
  }

  /**
   * 流式获取 `@我的微博`（游标自动翻页 + 跨页按 `mblogid` 去重）。
   *
   * 停止条件（任一命中）：`next_cursor === 0`、空页、游标不前进、整页重复、达到 `maxPages`。
   *
   * @example
   * for await (const tweet of sdk.users.streamMentions({ maxPages: 3 })) {
   *   console.log(tweet.mblogId, tweet.text)
   * }
   */
  async* streamMentions(options: UserMentionsStreamOptions = {}): AsyncIterableIterator<ITweet> {
    const maxPages = normalizeMaxPages(options.maxPages)
    const range = createStreamRange<ITweet>(options, tweet => tweet.createdAt)
    const seen = new Set<string>()
    let cursor: number | undefined = normalizeMaxId(options.maxId)
    let pageNo = normalizePage(options.page) ?? 1
    let pagesFetched = 0
    let processed = 0
    let total: number | undefined

    while (pagesFetched < maxPages) {
      const requestOptions: UserMentionsListOptions = cursor !== undefined
        ? { maxId: cursor }
        : options.page !== undefined
          ? { page: pageNo }
          : {}

      const startAt = Date.now()
      const page = await this.fetchMentionPage(requestOptions)
      pagesFetched += 1

      if (page.rawCount === 0)
        break // 空页：上游到底

      const fresh = page.tweets.filter((tweet) => {
        if (seen.has(tweet.mblogId))
          return false
        seen.add(tweet.mblogId)
        return true
      })
      if (fresh.length === 0)
        break // 整页重复：上游忽略了游标

      for (const tweet of fresh) {
        const decision = range.decide(tweet)
        if (decision === 'stop')
          break
        if (decision === 'skip')
          continue
        processed += 1
        yield tweet
      }

      await this.emitTelemetry({
        event_name: 'normalize_done',
        timestamp: Date.now(),
        trace_id: this.newTraceId(),
        model: 'Tweet',
        count: fresh.length,
        duration_ms: Date.now() - startAt,
      })

      if (page.total !== undefined)
        total = page.total

      const progress: UserMentionsStreamProgress = {
        cursor: page.cursor,
        page: pageNo,
        processed,
        pageSize: page.tweets.length,
      }
      if (total !== undefined)
        progress.total = total

      try {
        await options.onProgress?.(progress)
      }
      catch {
        // 进度回调异常不影响流
      }

      if (range.stopped)
        break
      if (page.cursor === 0)
        break
      if (cursor !== undefined && page.cursor === cursor)
        break // 游标不前进

      cursor = page.cursor
      pageNo += 1
    }
  }

  /**
   * 获取关注分组（D11，`/ajax/feed/allGroups`）。
   *
   * 上游按「默认分组 / 我的分组 / 订阅分组 / 我的频道」分类，归一化后拍平，
   * 用 `category` 保留分类名。
   *
   * @returns 去重后的分组列表
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async groups(): Promise<UserGroup[]> {
    const startAt = Date.now()
    const raw = await this.request(feedGroupsSpec, {})
    const groups = normalizeUserGroups(raw)
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'UserGroup',
      count: groups.length,
      duration_ms: Date.now() - startAt,
    })
    return groups
  }

  /**
   * 获取微博分组（D11，`/ajax/mblog/querygroup` 的 `data.join_groups`）。
   *
   * 无参数即返回当前账号加入的分组；`gid` 参数上游接受但实测不影响返回。
   *
   * @returns 去重后的微博分组列表
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async mblogGroups(): Promise<MblogGroup[]> {
    const startAt = Date.now()
    const raw = await this.request(mblogGroupsSpec, {})
    const groups = normalizeMblogGroups(raw)
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'MblogGroup',
      count: groups.length,
      duration_ms: Date.now() - startAt,
    })
    return groups
  }

  /** 拉取一页 mentions 并做单页去重 / 游标与总数解析。 */
  private async fetchMentionPage(options: UserMentionsListOptions): Promise<{
    tweets: ITweet[]
    cursor: number
    total?: number
    rawCount: number
  }> {
    const raw = await this.request(mentionsSpec, buildMentionArgs(options))
    const seen = new Set<string>()
    const tweets: ITweet[] = []

    for (const item of raw.data.statuses) {
      const tweet = new TweetModel(item)
      if (seen.has(tweet.mblogId))
        continue
      seen.add(tweet.mblogId)
      tweets.push(tweet)
    }

    return {
      tweets,
      cursor: parseCursor(raw.data.next_cursor),
      total: parseTotal(raw.data.total_number),
      rawCount: raw.data.statuses.length,
    }
  }
}
