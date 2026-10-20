import type { MessageArgs } from '../endpoints/notifications'
import type { IWeiboConfig } from '~/types/config'
import type { CommentNotification, LikeNotification } from '~/types/domain/INotification'
import { normalizeCommentNotification, normalizeLikeNotification } from '~/models/data/Notification'
import { messageAttitudesSpec, messageCommentsSpec } from '../endpoints/notifications'
import { FetcherService } from '../internal/FetcherService'

/** 一页评论通知（`listComments` 返回值）。 */
export interface CommentNotificationPageResult {
  /** 下一页游标（上游 `data.next_cursor`；`0` 表示到底） */
  cursor: number
  /** 是否可能还有下一页（`cursor !== 0` 且本页非空） */
  hasMore: boolean
  /** 上游 `total_number`（可用时） */
  total?: number
  /** 本页归一化通知（已按评论 id 去重） */
  items: CommentNotification[]
}

/** 一页点赞通知（`listLikes` 返回值）。 */
export interface LikeNotificationPageResult {
  /** 下一页游标（上游 `data.next_cursor`；`0` 表示到底） */
  cursor: number
  /** 是否可能还有下一页（`cursor !== 0` 且本页非空） */
  hasMore: boolean
  /** 上游 `total_number`（可用时） */
  total?: number
  /** 本页归一化通知（已按通知 id 去重） */
  items: LikeNotification[]
}

/** 消息列表选项（评论通知 / 点赞通知共用）。 */
export interface NotificationListOptions {
  /**
   * 游标：上一页返回的 `cursor`（上游参数名 `max_id`）。
   *
   * 数字字符串会自动转成 number；非数字 / 非正数按「未指定」处理。
   * **优先于 `page`**。
   */
  maxId?: number | string
  /** 页码（1 基，缺省 = 第一页）；仅在未给 `maxId` 时生效 */
  page?: number
}

/** 消息流进度（每页触发一次）。 */
export interface NotificationStreamProgress {
  /** 数据源：评论通知 / 点赞通知 */
  source: 'comment' | 'attitude'
  /** 本页返回的下一页游标 */
  cursor: number
  /** 本次请求的页码（1 基，按请求轮次递增） */
  page: number
  /** 已产出的通知数（跨页去重后） */
  processed: number
  /** 本页去重前的条数 */
  pageSize: number
  /** 上游 `total_number`（可用时） */
  total?: number
}

/** 消息流选项。 */
export interface NotificationStreamOptions extends NotificationListOptions {
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；回调抛错不会中断流 */
  onProgress?: (progress: NotificationStreamProgress) => void | Promise<void>
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

/** 组装上游参数：`max_id` 优先，其次 `page`，都不给则首屏。 */
function buildArgs(options: NotificationListOptions): MessageArgs {
  const maxId = normalizeMaxId(options.maxId)
  if (maxId !== undefined)
    return { max_id: maxId }
  const page = normalizePage(options.page)
  return page !== undefined ? { page } : {}
}

interface RawPage<T> {
  items: T[]
  cursor: number
  total?: number
  /** 上游原始条数（用于区分「空页」与「整页重复」） */
  rawCount: number
}

/**
 * 消息中心服务（D10）。
 *
 * - `comments`：`GET /ajax/message/cmt` —— 别人评论我 / 回复我的通知；
 * - `likes`：`GET /ajax/message/attitudes` —— 别人赞我的通知。
 *
 * 两者都是游标分页：翻页用 `max_id=<上一页 data.next_cursor>`（`page` 等价），
 * 到底时 `next_cursor === 0` 且数组为空。服务层同时做「游标不前进 / 整页重复 / maxPages」保护。
 *
 * 注意：`/ajax/message/count` 与 `/ajax/message/likeNotice` 已失效（200 + HTML 404 页），
 * 因此本服务不提供「未读数」能力。
 */
export class NotificationService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取一页评论通知。
   *
   * @param options 分页选项（`maxId` 优先于 `page`）
   * @returns 归一化通知 + 下一页游标
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async listComments(options: NotificationListOptions = {}): Promise<CommentNotificationPageResult> {
    const startAt = Date.now()
    const page = await this.fetchCommentsPage(options)
    await this.emitNormalize('CommentNotification', page.items.length, startAt)

    const result: CommentNotificationPageResult = {
      cursor: page.cursor,
      hasMore: page.cursor !== 0 && page.items.length > 0,
      items: page.items,
    }
    if (page.total !== undefined)
      result.total = page.total
    return result
  }

  /**
   * 流式获取评论通知（游标自动翻页 + 跨页按评论 id 去重）。
   *
   * 停止条件（任一命中）：`next_cursor === 0`、空页、游标不前进、整页重复、达到 `maxPages`。
   *
   * @example
   * for await (const notification of sdk.notifications.streamComments({ maxPages: 3 })) {
   *   console.log(notification.tweet.mblogId, notification.comment.text)
   * }
   */
  async* streamComments(options: NotificationStreamOptions = {}): AsyncIterableIterator<CommentNotification> {
    yield* this.streamPages({
      source: 'comment',
      options,
      fetchPage: requestOptions => this.fetchCommentsPage(requestOptions),
      itemId: item => item.comment.id,
      emit: (count, startAt) => this.emitNormalize('CommentNotification', count, startAt),
    })
  }

  /**
   * 获取一页点赞通知。
   *
   * @param options 分页选项（`maxId` 优先于 `page`）
   * @returns 归一化通知 + 下一页游标
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async listLikes(options: NotificationListOptions = {}): Promise<LikeNotificationPageResult> {
    const startAt = Date.now()
    const page = await this.fetchLikesPage(options)
    await this.emitNormalize('LikeNotification', page.items.length, startAt)

    const result: LikeNotificationPageResult = {
      cursor: page.cursor,
      hasMore: page.cursor !== 0 && page.items.length > 0,
      items: page.items,
    }
    if (page.total !== undefined)
      result.total = page.total
    return result
  }

  /**
   * 流式获取点赞通知（游标自动翻页 + 跨页按通知 id 去重）。
   *
   * @example
   * for await (const notification of sdk.notifications.streamLikes()) {
   *   console.log(notification.tweet.mblogId, notification.user.name)
   * }
   */
  async* streamLikes(options: NotificationStreamOptions = {}): AsyncIterableIterator<LikeNotification> {
    yield* this.streamPages({
      source: 'attitude',
      options,
      fetchPage: requestOptions => this.fetchLikesPage(requestOptions),
      itemId: item => item.id,
      emit: (count, startAt) => this.emitNormalize('LikeNotification', count, startAt),
    })
  }

  /**
   * 通用游标流：评论 / 点赞通知只在「原始条目类型」和「去重键」上不同。
   *
   * `yield*` 委托给生成器，避免在两个公开方法里复制分页保护逻辑。
   */
  private async* streamPages<T>(params: {
    source: NotificationStreamProgress['source']
    options: NotificationStreamOptions
    fetchPage: (options: NotificationListOptions) => Promise<RawPage<T>>
    itemId: (item: T) => string
    emit: (count: number, startAt: number) => Promise<void>
  }): AsyncIterableIterator<T> {
    const { source, options, fetchPage, itemId, emit } = params
    const maxPages = normalizeMaxPages(options.maxPages)
    const seen = new Set<string>()
    let cursor: number | undefined = normalizeMaxId(options.maxId)
    let pageNo = normalizePage(options.page) ?? 1
    let pagesFetched = 0
    let processed = 0
    let total: number | undefined

    while (pagesFetched < maxPages) {
      const requestOptions: NotificationListOptions = cursor !== undefined
        ? { maxId: cursor }
        : options.page !== undefined
          ? { page: pageNo }
          : {}

      const startAt = Date.now()
      const page = await fetchPage(requestOptions)
      pagesFetched += 1

      if (page.rawCount === 0)
        break // 空页：上游到底

      const fresh = page.items.filter((item) => {
        const id = itemId(item)
        if (!id)
          return true
        if (seen.has(id))
          return false
        seen.add(id)
        return true
      })
      if (fresh.length === 0)
        break // 整页重复：上游忽略了游标

      for (const item of fresh) {
        processed += 1
        yield item
      }
      await emit(fresh.length, startAt)

      if (page.total !== undefined)
        total = page.total

      const progress: NotificationStreamProgress = {
        source,
        cursor: page.cursor,
        page: pageNo,
        processed,
        pageSize: page.items.length,
      }
      if (total !== undefined)
        progress.total = total

      try {
        await options.onProgress?.(progress)
      }
      catch {
        // 进度回调异常不影响流
      }

      if (page.cursor === 0)
        break
      if (cursor !== undefined && page.cursor === cursor)
        break // 游标不前进

      cursor = page.cursor
      pageNo += 1
    }
  }

  private async fetchCommentsPage(options: NotificationListOptions): Promise<RawPage<CommentNotification>> {
    const raw = await this.request(messageCommentsSpec, buildArgs(options))
    const seen = new Set<string>()
    const items: CommentNotification[] = []

    for (const item of raw.data.comments) {
      const normalized = normalizeCommentNotification(item)
      if (!normalized)
        continue
      const id = normalized.comment.id
      if (id) {
        if (seen.has(id))
          continue
        seen.add(id)
      }
      items.push(normalized)
    }

    return {
      items,
      cursor: parseCursor(raw.data.next_cursor),
      total: parseTotal(raw.data.total_number),
      rawCount: raw.data.comments.length,
    }
  }

  private async fetchLikesPage(options: NotificationListOptions): Promise<RawPage<LikeNotification>> {
    const raw = await this.request(messageAttitudesSpec, buildArgs(options))
    const seen = new Set<string>()
    const items: LikeNotification[] = []

    for (const item of raw.data.attitudes) {
      const normalized = normalizeLikeNotification(item)
      if (!normalized)
        continue
      if (normalized.id) {
        if (seen.has(normalized.id))
          continue
        seen.add(normalized.id)
      }
      items.push(normalized)
    }

    return {
      items,
      cursor: parseCursor(raw.data.next_cursor),
      total: parseTotal(raw.data.total_number),
      rawCount: raw.data.attitudes.length,
    }
  }

  private async emitNormalize(
    model: 'CommentNotification' | 'LikeNotification',
    count: number,
    startAt: number,
  ): Promise<void> {
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model,
      count,
      duration_ms: Date.now() - startAt,
    })
  }
}
