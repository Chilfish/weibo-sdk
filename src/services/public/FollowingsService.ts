import type { FollowContentResponse, FriendshipsResponse } from '../endpoints/follow'
import type { IWeiboConfig } from '~/types/config'
import type { StreamLimitOptions } from '~/utils/streamRange'
import { normalizeMaxPages, paginate } from '../../utils/pagination'
import { followContentSpec, friendshipsSpec } from '../endpoints/follow'
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
