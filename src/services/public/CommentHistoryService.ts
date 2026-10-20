import type { MyCommentsArgs, MyCommentsResponse } from '../endpoints/commentHistory'
import type { IWeiboConfig } from '~/types/config'
import type { ITweetComment } from '~/types/domain/ITweet'
import type { StreamRangeOptions } from '~/utils/streamRange'
import { normalizeComment } from '~/models/data/Tweet'
import { createStreamRange } from '~/utils/streamRange'
import { myCommentsSpec } from '../endpoints/commentHistory'
import { FetcherService } from '../internal/FetcherService'

/** 一页「我的评论」的归一化结果（`listMine` 返回值）。 */
export interface CommentHistoryPageResult {
  /**
   * 下一页游标（上游 `data.next_cursor`）。
   *
   * 原样回填给 `maxId` 即可取下一页；`0` 表示已经到底。
   */
  cursor: number
  /**
   * 是否可能还有下一页。
   *
   * 判定：`cursor !== 0 && comments.length > 0`——上游到底时同时满足 `next_cursor === 0`
   * 与 `comments: []`，两者任一命中即视为结束。
   */
  hasMore: boolean
  /** 上游 `data.total_number`（缺失 / 非法时省略） */
  total?: number
  /** 本页归一化后的评论（已按评论 id 去重，保持上游顺序） */
  comments: ITweetComment[]
}

/** `listMine` 的选项。 */
export interface CommentHistoryListOptions {
  /**
   * 游标：上一页返回的 `cursor`（上游参数名 `max_id`）。
   *
   * 数字字符串（如 `'5302173179055029'`）会自动转成 number（上游 `max_id` 为 number）；
   * 非数字 / 非正数 / 非有限数按「未指定」处理。**优先于 `page`**。
   */
  maxId?: number | string
  /**
   * 页码（1 基，缺省 = 第一页），与 `maxId` 等价。
   *
   * 仅在未给 `maxId` 时生效；`< 1` / 非有限数按「未指定」处理（上游 `page=0` 视同 1）。
   */
  page?: number
}

/** 我的评论流进度（每页触发一次）。 */
export interface CommentHistoryStreamProgress {
  /** 用户 UID（`myCmt` 不需要 uid，按登录 Cookie 取当前用户；该字段保留给调用方自行填充） */
  uid?: string
  /** 本页返回的下一页游标（上游 `next_cursor`） */
  cursor: number
  /** 本次请求的页码（1 基；游标翻页时按请求轮次递增） */
  page: number
  /** 已产出的评论数（跨页去重后） */
  processed: number
  /** 本页去重前的评论条数 */
  pageSize: number
  /** 上游 `total_number`（可用时） */
  total?: number
}

/** `streamMine` 的选项。 */
export interface CommentHistoryStreamOptions extends CommentHistoryListOptions, StreamRangeOptions {
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；回调抛错不会中断流 */
  onProgress?: (progress: CommentHistoryStreamProgress) => void | Promise<void>
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

/** 评论的 raw id（`idstr` 优先，退回 `id`）；缺失时为空串。 */
function rawCommentId(item: unknown): string {
  if (!item || typeof item !== 'object')
    return ''
  const record = item as Record<string, unknown>
  return String(record.idstr || record.id || '')
}

interface RawCommentPage {
  /** 已按评论 id 单页去重的归一化评论 */
  comments: ITweetComment[]
  /** 上游 `next_cursor`（0 = 到底） */
  cursor: number
  /** 上游 `total_number`（可用时） */
  total?: number
  /** 单页去重前的条数（用于区分「空页」与「整页重复」） */
  rawCount: number
}

/**
 * 我的评论历史领域服务（D2）。
 *
 * 对应 `GET https://weibo.com/ajax/message/myCmt`：**只读当前登录用户自己发表的历史评论**
 * （隐私边界=「我评论过别人什么」，不涉及任何他人评论列表的下发；由 Cookie 决定身份，
 * 端点不接受 uid 参数，因此本服务也不提供 `uid` 入参）。
 *
 * 分页语义（实测 2026-10-20）：
 * - 首屏不带参数即可（等价 `page=1`）；翻页用 `max_id=<上一页 data.next_cursor>`；
 * - `page=<n>`（1 基）同样生效，与 `max_id` 等价；`cursor=` 参数**被上游忽略**，本服务不发；
 * - 停止条件：`data.next_cursor === 0`（此时 `comments: []`）。
 *
 * 每条评论内嵌完整的 `status`（被评论微博）与 `user`，因此单页体积偏大（~460K）；
 * 归一化后只暴露契约字段（见 {@link ITweetComment}）。
 */
export class CommentHistoryService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取并归一化一页「我的评论」（游标分页）。
   *
   * 参数优先级：`maxId` > `page` > 都不传（首屏）。单页内按评论 id 去重（保持上游顺序）；
   * `hasMore = cursor !== 0 && comments.length > 0`。
   *
   * @param options 分页选项
   * @param options.maxId 游标（上游 `max_id`，即上一页的 `cursor`；数字字符串自动转 number）
   * @param options.page 页码（1 基，与 `maxId` 等价；未给 `maxId` 时生效）
   * @returns 本页归一化评论 + 下一页游标 + 上游 `total_number`
   *
   * @throws `WeiboAPINotOkError` 上游 `ok !== 1`（如 Cookie 失效）
   * @throws `UnexpectedAPIResponseError` 响应不满足 `myCommentsSpec.schema`（含 HTML 登录页）
   * @throws `RateLimitError` / `NetworkRequestError` / `ConnectionTimeoutError` 传输层错误
   *
   * @example
   * const page1 = await sdk.commentHistory.listMine()
   * const page2 = await sdk.commentHistory.listMine({ maxId: page1.cursor })
   */
  public async listMine(options: CommentHistoryListOptions = {}): Promise<CommentHistoryPageResult> {
    const traceId = this.newTraceId()
    const startAt = Date.now()
    const page = await this.fetchPage(options)

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'Tweet',
      count: page.comments.length,
      duration_ms: Date.now() - startAt,
    })

    const result: CommentHistoryPageResult = {
      cursor: page.cursor,
      hasMore: page.cursor !== 0 && page.comments.length > 0,
      comments: page.comments,
    }
    if (page.total !== undefined)
      result.total = page.total
    return result
  }

  /**
   * 流式获取「我的评论」历史（游标自动翻页 + 跨页去重）。
   *
   * 首轮用调用方给的 `maxId` / `page`（都不给则取首屏），之后每轮把上一页的
   * `cursor` 作为 `maxId` 继续。停止条件（任一命中即结束）：
   * 1. `next_cursor === 0`（上游到底，`comments` 为空）；
   * 2. 空页（`comments.length === 0`）；
   * 3. 游标不前进（新的 `next_cursor` 与本次请求用的游标相同）；
   * 4. 整页重复（本页全部评论都已在之前页出现过，通常是上游忽略了游标）；
   * 5. 达到 `maxPages`。
   *
   * @param options 翻页选项
   * @param options.maxId 起始游标（缺省 = 首屏）
   * @param options.page 起始页码（1 基；未给 `maxId` 时生效）
   * @param options.maxPages 最多翻页数（默认不限）
   * @param options.onProgress 每页进度回调；回调抛错不会中断流
   *
   * @throws 与 `listMine` 相同的异常（第 N 页失败即整体抛错，已 yield 的条目不回滚）
   *
   * @example
   * for await (const comment of sdk.commentHistory.streamMine({ maxPages: 3 })) {
   *   console.log(comment.parentMblogId, comment.text)
   * }
   */
  async* streamMine(options: CommentHistoryStreamOptions = {}): AsyncIterableIterator<ITweetComment> {
    const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY
    const range = createStreamRange<ITweetComment>(options, comment => comment.createdAt)
    const traceId = this.newTraceId()
    const startAt = Date.now()

    const seen = new Set<string>()
    let cursor: number | undefined = normalizeMaxId(options.maxId)
    let pageNo = normalizePage(options.page) ?? 1
    let pagesFetched = 0
    let processed = 0
    let total: number | undefined

    while (pagesFetched < maxPages) {
      // 首轮尊重调用方给的 maxId / page，之后统一用游标翻页
      const requestOptions: CommentHistoryListOptions = cursor !== undefined
        ? { maxId: cursor }
        : options.page !== undefined
          ? { page: pageNo }
          : {}

      const page = await this.fetchPage(requestOptions)
      pagesFetched += 1

      if (page.rawCount === 0)
        break // 空页：上游到底

      const fresh: ITweetComment[] = []
      for (const comment of page.comments) {
        if (comment.id) {
          if (seen.has(comment.id))
            continue
          seen.add(comment.id)
        }
        fresh.push(comment)
      }
      if (fresh.length === 0)
        break // 整页重复：上游忽略了游标，视为到底

      for (const comment of fresh) {
        const decision = range.decide(comment)
        if (decision === 'stop')
          break
        if (decision === 'skip')
          continue
        processed += 1
        yield comment
      }

      if (page.total !== undefined)
        total = page.total

      const progress: CommentHistoryStreamProgress = {
        cursor: page.cursor,
        page: pageNo,
        processed,
        pageSize: page.comments.length,
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
        break // 到底
      if (cursor !== undefined && page.cursor === cursor)
        break // 游标不前进（上游卡住同一游标）

      cursor = page.cursor
      pageNo += 1
    }

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: traceId,
      model: 'Tweet',
      count: processed,
      duration_ms: Date.now() - startAt,
    })
  }

  /**
   * 拉取一页原始响应（schema 已校验），供归档编排生成 `schemaDigest` 使用。
   *
   * @internal
   */
  public async fetchRawPage(options: CommentHistoryListOptions = {}): Promise<MyCommentsResponse> {
    return this.request(myCommentsSpec, this.buildArgs(options))
  }

  /** 组装上游参数：`max_id` 优先，其次 `page`，都不给则首屏（不带参数）。 */
  private buildArgs(options: CommentHistoryListOptions): MyCommentsArgs {
    const maxId = normalizeMaxId(options.maxId)
    if (maxId !== undefined)
      return { max_id: maxId }
    const page = normalizePage(options.page)
    return page !== undefined ? { page } : {}
  }

  /** 拉取一页并做单页去重 / 游标与总数解析；不做跨页去重（由 `streamMine` 负责）。 */
  private async fetchPage(options: CommentHistoryListOptions): Promise<RawCommentPage> {
    const raw = await this.request(myCommentsSpec, this.buildArgs(options))

    const seen = new Set<string>()
    const comments: ITweetComment[] = []
    for (const item of raw.data.comments) {
      const id = rawCommentId(item)
      if (id) {
        if (seen.has(id))
          continue
        seen.add(id)
      }
      comments.push(normalizeComment(item))
    }

    return {
      comments,
      cursor: parseCursor(raw.data.next_cursor),
      total: parseTotal(raw.data.total_number),
      rawCount: raw.data.comments.length,
    }
  }
}
