import type { IWeiboConfig } from '~/types/config'
import type { SuperTopic, SuperTopicCategory } from '~/types/domain/ISuperTopic'
import type { PaginationProgress } from '~/utils/pagination'
import type { StreamLimitOptions } from '~/utils/streamRange'
import { normalizeSuperTopic, normalizeSuperTopicCategory } from '~/models/data/SuperTopic'
import { normalizeMaxPages, paginate } from '~/utils/pagination'
import { stopicCatesSpec, stopicListSpec } from '../endpoints/topic'
import { FetcherService } from '../internal/FetcherService'

/** 一页超话列表（`list` 返回值）。 */
export interface SuperTopicPageResult {
  /** 下一页页码（从 1 开始；`hasMore=false` 时无意义） */
  page: number
  /** 是否可能还有下一页（空页 / 已到 `count` 时为 `false`） */
  hasMore: boolean
  /** 上游 `count`（总页数，30 条/页；可用时） */
  totalPages?: number
  /** 本页归一化超话（已按 pageId 去重） */
  topics: SuperTopic[]
}

/** `list` 的选项。 */
export interface SuperTopicListOptions {
  /** 分类 id（来自 `cates()` 的 `id`）；与 `keyword` 同传时上游会忽略分类 */
  sortId?: number
  /** 关键词搜索（非空时按关键词搜索） */
  keyword?: string
  /** 页码（从 1 开始；缺省 = 第一页） */
  page?: number
}

/** `stream` 的选项。 */
export interface SuperTopicStreamOptions extends Omit<SuperTopicListOptions, 'page'>, StreamLimitOptions {
  /** 起始页码（从 1 开始） */
  page?: number
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；回调抛错不会中断流 */
  onProgress?: (progress: PaginationProgress<number>) => void | Promise<void>
}

/** 页码归一化：只接受 >= 1 的有限数；其余按第一页处理。 */
function normalizePage(page?: number): number {
  if (page === undefined || !Number.isFinite(page))
    return 1
  return Math.max(1, Math.floor(page))
}

/**
 * 超话服务（D7）：分类列表、超话列表 / 关键词搜索。
 *
 * 端点均来自网页端 bundle 的真实调用点：
 * - `GET /ajax/stopic/cates` → 分类；
 * - `GET /ajax/stopic/list?sort_id=&keyword=&page=` → 分类浏览 / 搜索（`count` 是总页数）。
 */
export class TopicService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取超话分类（`/ajax/stopic/cates`）。
   *
   * @returns 分类列表（`id` 可直接作为 `list({ sortId })`）
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async cates(): Promise<SuperTopicCategory[]> {
    const startAt = Date.now()
    const raw = await this.request(stopicCatesSpec, {})
    const categories = raw.data
      .map(normalizeSuperTopicCategory)
      .filter((category): category is SuperTopicCategory => category !== undefined)

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'SuperTopicCategory',
      count: categories.length,
      duration_ms: Date.now() - startAt,
    })

    return categories
  }

  /**
   * 获取一页超话列表 / 搜索结果。
   *
   * @param options 列表选项
   * @param options.sortId 分类 id（`cates()` 返回）
   * @param options.keyword 关键词（非空时按搜索）
   * @param options.page 页码（从 1 开始）
   * @returns 归一化超话 + 下一页页码
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async list(options: SuperTopicListOptions = {}): Promise<SuperTopicPageResult> {
    const page = normalizePage(options.page)
    const keyword = options.keyword?.trim()
    const args: { sort_id?: number, keyword?: string, page: number } = { page }
    if (keyword) {
      args.sort_id = options.sortId ?? 0
      args.keyword = keyword
    }
    else if (options.sortId !== undefined) {
      args.sort_id = options.sortId
      args.keyword = ''
    }

    const startAt = Date.now()
    const raw = await this.request(stopicListSpec, args)
    const seen = new Set<string>()
    const topics: SuperTopic[] = []
    for (const item of raw.data) {
      const topic = normalizeSuperTopic(item)
      if (!topic || seen.has(topic.pageId))
        continue
      seen.add(topic.pageId)
      topics.push(topic)
    }

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'SuperTopic',
      count: topics.length,
      duration_ms: Date.now() - startAt,
    })

    const result: SuperTopicPageResult = {
      page: page + 1,
      hasMore: topics.length > 0 && (raw.count === undefined || page < raw.count),
      topics,
    }
    if (raw.count !== undefined)
      result.totalPages = raw.count
    return result
  }

  /**
   * 流式遍历超话列表 / 搜索结果（page 游标 + 跨页按 pageId 去重）。
   *
   * 停止条件（任一命中）：空页、整页重复、达到上游 `count` 页数、`maxPages`。
   *
   * @example
   * for await (const topic of sdk.topics.stream({ keyword: '游戏' })) {
   *   console.log(topic.pageId, topic.title)
   * }
   */
  async* stream(options: SuperTopicStreamOptions = {}): AsyncIterableIterator<SuperTopic> {
    yield* paginate<SuperTopic, number>(
      async (cursor) => {
        const page = normalizePage(cursor)
        const result = await this.list({
          sortId: options.sortId,
          keyword: options.keyword,
          page,
        })
        const out: { items: SuperTopic[], next?: number, hasMore?: boolean } = {
          items: result.topics,
          hasMore: result.hasMore,
        }
        if (result.hasMore)
          out.next = page + 1
        return out
      },
      {
        initialCursor: normalizePage(options.page),
        maxPages: normalizeMaxPages(options.maxPages),
        maxItems: options.maxItems,
        getKey: topic => topic.pageId,
        onProgress: options.onProgress,
      },
    )
  }
}
