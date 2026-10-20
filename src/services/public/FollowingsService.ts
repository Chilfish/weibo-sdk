import type { FollowContentResponse, FriendshipsResponse } from '../endpoints/follow'
import type { MobileContainerResponse } from '../endpoints/mobile'
import type { IWeiboConfig } from '~/types/config'
import type { StreamLimitOptions } from '~/utils/streamRange'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { normalizeMaxPages, paginate } from '../../utils/pagination'
import { followContentSpec, friendshipsSpec } from '../endpoints/follow'
import { extractMobileUsers, mobileContainerSpec } from '../endpoints/mobile'
import { FetcherService } from '../internal/FetcherService'

/** 关注关系数据源。 */
export type FollowingsSource = 'following' | 'fans' | 'my'

/** 关注关系流进度（每页触发一次）。 */
export interface FollowingsStreamProgress {
  /** 目标用户 UID（`source: 'my'` 时缺省） */
  uid?: string
  /** 数据源：关注 / 粉丝 / 我的关注 */
  source: FollowingsSource
  /** 当前页码（从 1 开始） */
  page: number
  /** 已产出的用户数（跨页去重后） */
  processed: number
  /** 本页去重前的条数 */
  pageSize: number
  /** 上游总数（可用时） */
  total?: number
}

/** 关注关系流选项。 */
export interface FollowingsStreamOptions extends StreamLimitOptions {
  /** 起始页码（缺省 = 第一页） */
  page?: number
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；异常不会中断流 */
  onProgress?: (progress: FollowingsStreamProgress) => void | Promise<void>
}

type FollowingUser = FriendshipsResponse['users'][number]

function userKey(user: FollowingUser): string | undefined {
  const id = user.idstr ?? (user.id === undefined ? undefined : String(user.id))
  return id || undefined
}

function usersFromFriendships(raw: FriendshipsResponse): { users: FollowingUser[], total?: number } {
  return { users: raw.users ?? [], total: raw.total_number }
}

function usersFromFollowContent(raw: FollowContentResponse): { users: FollowingUser[], total?: number } {
  return {
    users: raw.data.follows.users ?? [],
    total: raw.data.follows.total_number ?? raw.data.total_number,
  }
}

function assertFirstPage(page: number | undefined, source: string): void {
  if (page !== undefined && page > 1) {
    throw new InvalidConfigError(
      `Guest mode can only read the first page of ${source}; anonymous page 2 is login-gated.`,
      { field: 'page', page, source, guestPagination: 'first_page' },
    )
  }
}

/** 解析 m 站的数字 / 缩写计数（`27089`、`"2.7万"`、`"1.2亿"`）；无法解析时返回 undefined。 */
function parseMobileCount(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string')
    return undefined

  const match = /^(\d+(?:\.\d+)?)\s*(万|亿)?$/.exec(value.trim())
  if (!match)
    return undefined
  const base = Number(match[1])
  if (!Number.isFinite(base))
    return undefined
  if (match[2] === '万')
    return Math.round(base * 10_000)
  if (match[2] === '亿')
    return Math.round(base * 100_000_000)
  return base
}

/** 补齐 `id` / `idstr`：m 站通常只有数字 `id`，Cookie 路径两者都有。 */
function normalizeMobileId(user: Record<string, unknown>): { id?: string | number, idstr?: string } {
  const rawIdstr = typeof user.idstr === 'string' && user.idstr.trim() !== '' ? user.idstr.trim() : undefined
  if (typeof user.id === 'number' && Number.isFinite(user.id))
    return { id: user.id, idstr: rawIdstr ?? String(user.id) }
  if (rawIdstr !== undefined)
    return { id: /^\d+$/.test(rawIdstr) ? Number(rawIdstr) : rawIdstr, idstr: rawIdstr }
  return {}
}

/** 把 m 站用户对象归一化成 Cookie 路径 `friendships.users[]` 的字段形状。 */
function normalizeMobileUser(user: Record<string, unknown>): FollowingUser {
  const ids = normalizeMobileId(user)
  const name = typeof user.name === 'string' && user.name !== '' ? user.name : user.screen_name
  const followers = parseMobileCount(user.followers_count)
  const friends = parseMobileCount(user.friends_count ?? user.follow_count)
  const statuses = parseMobileCount(user.statuses_count)
  const { user_token: _userToken, ...rest } = user

  return {
    ...rest,
    ...ids,
    ...(typeof name === 'string' ? { name } : {}),
    ...(followers === undefined ? {} : { followers_count: followers }),
    ...(friends === undefined ? {} : { friends_count: friends }),
    ...(statuses === undefined ? {} : { statuses_count: statuses }),
  } as FollowingUser
}

/** 把 m 站 container 第一页的 `card.user` 适配成 `friendships` 响应形状。 */
function mobileUsersToFriendships(raw: MobileContainerResponse): FriendshipsResponse {
  const users = extractMobileUsers(raw).map(normalizeMobileUser)
  const total = raw.data.cardlistInfo?.total
  return {
    ok: 1,
    users,
    ...(total === undefined ? {} : { total_number: total }),
    next_cursor: 0,
  }
}

/**
 * 关注关系领域服务。
 *
 * 覆盖三条路径：指定用户的关注列表、指定用户的粉丝列表、当前登录用户自己的关注列表
 * （后者走上游 `followContent`，分页语义与 friendships 略有差异）。
 */
export class FollowingsService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取用户关注列表 (cursor 分页)
   *
   * @param uid 目标用户 UID
   * @param page 页码（从 1 开始；缺省 = 第一页）
   * @returns 校验后的 friendships 响应（`data.users` 为用户数组，含 `next_cursor`）
   */
  public async getFollowings(uid: string, page?: number): Promise<FriendshipsResponse> {
    if (this.authMode === 'guest') {
      assertFirstPage(page, 'followings')
      // 上游命名与直觉相反：`followers` 容器返回「他的全部关注」
      return mobileUsersToFriendships(
        await this.request(mobileContainerSpec, { containerid: `231051_-_followers_-_${uid}` }),
      )
    }
    const args: { uid: string, page?: number } = { uid }
    if (page !== undefined)
      args.page = page
    return await this.request(friendshipsSpec, args)
  }

  /**
   * 获取用户粉丝列表 (relate=fans, cursor 分页)
   *
   * @param uid 目标用户 UID
   * @param page 页码（从 1 开始；缺省 = 第一页）
   * @returns 校验后的 friendships 响应（`data.users` 为粉丝数组）
   */
  public async getFans(uid: string, page?: number): Promise<FriendshipsResponse> {
    if (this.authMode === 'guest') {
      assertFirstPage(page, 'fans')
      // 上游命名与直觉相反：`follows` 容器返回「他的全部粉丝」
      return mobileUsersToFriendships(
        await this.request(mobileContainerSpec, { containerid: `231051_-_follows_-_${uid}` }),
      )
    }
    const args: { uid: string, relate: 'fans', page?: number } = { uid, relate: 'fans' }
    if (page !== undefined)
      args.page = page
    return await this.request(friendshipsSpec, args)
  }

  /**
   * 获取自己关注列表 (cursor 分页)
   *
   * 说明：不需要 uid，使用当前 Cookie 的登录用户；响应结构与 `getFollowings` 不同（走 followContent 端点）。
   *
   * @param page 页码（从 1 开始；缺省 = 第一页）
   * @returns 校验后的 `followContent` 响应（`data.list` 为关注关系条目）
   */
  public async getMyFollowings(page?: number): Promise<FollowContentResponse> {
    const args: { page?: number } = {}
    if (page !== undefined)
      args.page = page
    return await this.request(followContentSpec, args)
  }

  /**
   * 流式遍历用户关注列表（page 游标 + 跨页按用户 id 去重）。
   *
   * 停止条件（任一命中）：空页、整页重复、达到 `total_number`、`maxPages`。
   *
   * @example
   * for await (const user of sdk.followings.streamFollowings('1111681197', { maxPages: 2 })) {
   *   console.log(user.id, user.screen_name)
   * }
   */
  async* streamFollowings(uid: string, options: FollowingsStreamOptions = {}): AsyncIterableIterator<FollowingUser> {
    if (this.authMode === 'guest') {
      yield* this.streamMobileUsers('following', uid, await this.getFollowings(uid, options.page), options)
      return
    }
    yield* this.streamUsers(
      'following',
      uid,
      cursor => this.getFollowings(uid, cursor),
      usersFromFriendships,
      options,
    )
  }

  /**
   * 流式遍历用户粉丝列表（page 游标 + 跨页按用户 id 去重）。
   *
   * @example
   * for await (const fan of sdk.followings.streamFans('1111681197', { maxPages: 2 })) {
   *   console.log(fan.id, fan.screen_name)
   * }
   */
  async* streamFans(uid: string, options: FollowingsStreamOptions = {}): AsyncIterableIterator<FollowingUser> {
    if (this.authMode === 'guest') {
      yield* this.streamMobileUsers('fans', uid, await this.getFans(uid, options.page), options)
      return
    }
    yield* this.streamUsers(
      'fans',
      uid,
      cursor => this.getFans(uid, cursor),
      usersFromFriendships,
      options,
    )
  }

  /**
   * 流式遍历当前登录用户的关注列表（`followContent`，page 游标）。
   *
   * @example
   * for await (const user of sdk.followings.streamMyFollowings({ maxPages: 2 })) {
   *   console.log(user.id, user.screen_name)
   * }
   */
  async* streamMyFollowings(options: FollowingsStreamOptions = {}): AsyncIterableIterator<FollowingUser> {
    yield* this.streamUsers(
      'my',
      undefined,
      cursor => this.getMyFollowings(cursor),
      usersFromFollowContent,
      options,
    )
  }

  /** guest 模式：只产出一页用户（上游匿名只有第一页）。 */
  private async* streamMobileUsers(
    source: FollowingsSource,
    uid: string,
    raw: FriendshipsResponse,
    options: FollowingsStreamOptions,
  ): AsyncIterableIterator<FollowingUser> {
    const limit = options.maxItems
    let processed = 0
    for (const user of raw.users) {
      if (limit !== undefined && processed >= limit)
        break
      processed += 1
      yield user
    }
    try {
      await options.onProgress?.({
        uid,
        source,
        page: 1,
        processed,
        pageSize: raw.users.length,
        total: raw.total_number,
      })
    }
    catch {
      // 进度回调异常不影响流
    }
  }

  private async* streamUsers<TRaw>(
    source: FollowingsSource,
    uid: string | undefined,
    fetch: (page: number) => Promise<TRaw>,
    extract: (raw: TRaw) => { users: FollowingUser[], total?: number },
    options: FollowingsStreamOptions,
  ): AsyncIterableIterator<FollowingUser> {
    const initialCursor = options.page !== undefined ? Math.max(1, Math.floor(options.page)) : 1
    const maxPages = normalizeMaxPages(options.maxPages)

    for await (const user of paginate<FollowingUser, number>(
      async (cursor) => {
        const page = cursor ?? 1
        const raw = await fetch(page)
        const { users, total } = extract(raw)
        return {
          items: users,
          next: page + 1,
          total,
        }
      },
      {
        initialCursor,
        maxPages,
        maxItems: options.maxItems,
        getKey: userKey,
        onProgress: progress => options.onProgress?.({
          uid,
          source,
          page: progress.page,
          processed: progress.processed,
          pageSize: progress.pageSize,
          total: progress.total,
        }),
      },
    )) {
      yield user
    }
  }
}
