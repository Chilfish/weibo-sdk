import type { FavoritesResponse, FavoritesTagsResponse } from '../endpoints/favorite'
import type { IWeiboConfig } from '~/types/config'
import type { FavoriteTag } from '~/types/domain/IFavorite'
import type { ITweet } from '~/types/domain/ITweet'
import type { StreamLimitOptions } from '~/utils/streamRange'
import { matchesFavoriteTag, normalizeFavoriteTag } from '~/models/data/Favorite'
import { Tweet } from '~/models/data/Tweet'
import { createStreamRange } from '~/utils/streamRange'
import { favoritesSpec, favoritesTagsSpec } from '../endpoints/favorite'
import { FetcherService } from '../internal/FetcherService'

type FavoriteRawItem = FavoritesResponse['data']['status'][number]

/** 收藏标签列表（`getTags` 返回值）。 */
export interface FavoriteTagList {
  /** 归一化标签（无法识别 id / name 的元素已跳过） */
  tags: FavoriteTag[]
  /** 上游 `total_number`（可用时） */
  total?: number
}

/** 一页收藏的归一化结果（`listFavorites` 返回值）。 */
export interface FavoritePageResult {
  /** 下一页页码（page 游标） */
  page: number
  /**
   * 是否可能还有下一页。
   *
   * 优先用上游顶层 `total_page`；缺失时退回 `total_number` 估算，仍不可用则按
   * 「有下一页」处理，由流式路径的整页重复保护兜底。
   */
  hasMore: boolean
  /** 上游 `total_number`（缺失或非法时省略） */
  total?: number
  /** 上游顶层 `total_page`（缺失时省略） */
  totalPages?: number
  /** 本页归一化后的收藏（已按 `mblogId` 去重，并应用 `tag` 过滤） */
  tweets: ITweet[]
}

/** `listFavorites` 的选项。 */
export interface FavoriteListOptions {
  /** 页码（从 1 开始；缺省 = 第一页；`< 1` / 非有限数按第一页处理，避免上游 400） */
  page?: number
  /**
   * 只返回带指定标签的收藏（按标签 id 或名称精确匹配）。
   *
   * 标签来自收藏项自带的 `tags` 字段，属于客户端过滤；`getTags()` 可先读取标签清单。
   */
  tag?: string | number
}

/** 收藏流进度（每页触发一次）。 */
export interface FavoriteStreamProgress {
  /** 收藏所属用户 UID */
  uid: string
  /** 当前页码 */
  page: number
  /** 已产出的收藏数（跨页去重 + `tag` 过滤后） */
  processed: number
  /** 上游 `total_number`（可用时） */
  total?: number
  /** 上游顶层 `total_page`（可用时） */
  totalPages?: number
  /** 本页去重后的原始收藏数（过滤前） */
  pageSize: number
  /** 本页去重后的新增条目中，命中 `tag` 过滤的条数（未设置 `tag` 时等于新增条目数） */
  matched: number
}

/** `streamFavorites` 的选项。 */
export interface FavoriteStreamOptions extends FavoriteListOptions, StreamLimitOptions {
  /** 最多翻页数（默认不限） */
  maxPages?: number
  /** 每页进度回调；异常不会中断流 */
  onProgress?: (progress: FavoriteStreamProgress) => void | Promise<void>
}

/** 页码归一化：只接受 >= 1 的有限数；其余按「未指定」处理（上游 page 从 1 开始，0 会 400）。 */
function normalizePage(page?: number): number | undefined {
  if (page === undefined || !Number.isFinite(page))
    return undefined
  const normalized = Math.floor(page)
  return normalized >= 1 ? normalized : undefined
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

/** 单页内按 `mblogid` 去重（保持上游顺序）。 */
function uniqueByMblogId(items: FavoriteRawItem[]): FavoriteRawItem[] {
  const seen = new Set<string>()
  const out: FavoriteRawItem[] = []
  for (const item of items) {
    if (seen.has(item.mblogid))
      continue
    seen.add(item.mblogid)
    out.push(item)
  }
  return out
}

interface FavoriteRawPage {
  items: FavoriteRawItem[]
  total?: number
  totalPages?: number
  hasMore: boolean
}

/**
 * 收藏领域服务。
 *
 * 提供收藏夹内容（page 分页）与收藏标签读取；`listFavorites` / `streamFavorites`
 * 在 raw 响应之上做归一化、去重与客户端标签过滤，`ArchiveService` 的 favorites
 * 阶段仍使用 raw 的 `getFavorites`。
 */
export class FavoriteService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取收藏夹 GET /ajax/favorites/all_fav
   *
   * 内部固定 `with_total=true`：否则 `data` 返回裸数组而非 `{ status: [...] }` 对象，schema 校验会失败。
   *
   * @param uid 收藏所属用户 UID
   * @param page 页码（从 1 开始；缺省 = 第一页；`< 1` / 非有限数按第一页处理）
   * @returns 校验后的收藏响应，`data.status` 为收藏微博数组、`data.total_number` 为总数
   */
  public async fetchRawFavorites(uid: string, page?: number): Promise<FavoritesResponse> {
    // with_total=true 让 data 返回 { status: [...] } 对象结构（否则是裸数组，schema 校验失败）
    const args: { uid: string, page?: number, with_total: boolean } = { uid, with_total: true }
    const normalizedPage = normalizePage(page)
    if (normalizedPage !== undefined)
      args.page = normalizedPage
    return await this.request(favoritesSpec, args)
  }

  /**
   * 获取并归一化一页收藏（page 游标）。
   *
   * 单页内按 `mblogid` 去重；`tag` 为客户端过滤（基于收藏项自带的 `tags` 字段）。
   * `hasMore` 依据 `total_page` / `total_number` 估算，跨页去重由 `streamFavorites` 负责。
   *
   * @param uid 收藏所属用户 UID
   * @param options 分页 / 过滤选项
   * @param options.page 页码（从 1 开始，缺省 1）
   * @param options.tag 只保留带指定标签的收藏（标签 id 或名称）
   * @returns 归一化后的本页收藏 + 下一页页码
   * @throws `WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误
   */
  public async listFavorites(uid: string, options: FavoriteListOptions = {}): Promise<FavoritePageResult> {
    const page = normalizePage(options.page) ?? 1
    const rawPage = await this.fetchFavoritePage(uid, page)
    const tweets = rawPage.items
      .filter(item => options.tag === undefined || matchesFavoriteTag(item, options.tag))
      .map(item => new Tweet(item))

    return {
      page: page + 1,
      hasMore: rawPage.hasMore,
      total: rawPage.total,
      totalPages: rawPage.totalPages,
      tweets,
    }
  }

  /**
   * 流式获取收藏夹（自动翻页 + 跨页去重 + 可选标签过滤）。
   *
   * 逐条产出归一化后的 `Tweet`；停止条件为：空页、整页重复（上游忽略 page）、
   * 达到 `total_page` / `total_number`、达到 `maxPages`。`tag` 过滤在去重之后应用，被过滤掉的
   * 条目仍参与重复页判定，避免上游重复返回同一页时死循环。
   *
   * @param uid 收藏所属用户 UID
   * @param options 翻页 / 过滤选项
   * @param options.page 起始页码（从 1 开始，缺省 1）
   * @param options.tag 只产出带指定标签的收藏（标签 id 或名称）
   * @param options.maxPages 最多翻页数（默认不限）
   * @param options.onProgress 每页进度回调；异常不会中断流
   *
   * @example
   * for await (const tweet of sdk.favorites.streamFavorites('1111681197')) {
   *   console.log(tweet.mblogId, tweet.text)
   * }
   */
  async* streamFavorites(uid: string, options: FavoriteStreamOptions = {}): AsyncIterableIterator<ITweet> {
    const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY
    const range = createStreamRange<ITweet>(options)
    const tag = options.tag
    let page = normalizePage(options.page) ?? 1
    let pages = 0
    let processed = 0
    const seen = new Set<string>()

    while (pages < maxPages) {
      const rawPage = await this.fetchFavoritePage(uid, page)
      if (rawPage.items.length === 0)
        break

      const fresh = rawPage.items.filter(item => !seen.has(item.mblogid))
      if (fresh.length === 0)
        break // 整页重复：上游忽略了 page，视为到底

      for (const item of fresh)
        seen.add(item.mblogid)

      const matched = tag === undefined
        ? fresh
        : fresh.filter(item => matchesFavoriteTag(item, tag))

      for (const item of matched) {
        const tweet = new Tweet(item)
        const decision = range.decide(tweet)
        if (decision === 'stop')
          break
        if (decision === 'skip')
          continue
        processed += 1
        yield tweet
      }

      try {
        await options.onProgress?.({
          uid,
          page,
          processed,
          total: rawPage.total,
          totalPages: rawPage.totalPages,
          pageSize: rawPage.items.length,
          matched: matched.length,
        })
      }
      catch {
        // 进度回调异常不影响流
      }

      if (range.stopped)
        break
      if (!rawPage.hasMore)
        break
      page += 1
      pages += 1
    }
  }

  /**
   * 获取收藏夹标签原始响应（低层数据源，公开使用请走 `getTags`）
   */
  public async fetchRawTags(): Promise<FavoritesTagsResponse> {
    return await this.request(favoritesTagsSpec, {})
  }

  /**
   * 获取收藏夹标签（归一化）。
   *
   * 上游标签元素结构尚无真实样本；按常见键做 best-effort 映射。
   */
  public async getTags(): Promise<FavoriteTagList> {
    const raw = await this.fetchRawTags()
    const tags: FavoriteTag[] = []
    for (const item of raw.tags) {
      const tag = normalizeFavoriteTag(item)
      if (tag)
        tags.push(tag)
    }
    const result: FavoriteTagList = { tags }
    if (raw.total_number !== undefined)
      result.total = raw.total_number
    return result
  }

  /**
   * 拉取并做单页去重 / 分页字段解析；`hasMore` 只描述上游分页，不感知 tag 过滤。
   *
   * 优先用顶层 `total_page`（线上实测存在，且比 `total_number` 可靠）；
   * 部分 fixture 缺该字段时退回 `total_number` 估算。
   */
  private async fetchFavoritePage(uid: string, page: number): Promise<FavoriteRawPage> {
    const raw = await this.fetchRawFavorites(uid, page)
    const items = uniqueByMblogId(raw.data.status || [])
    const total = parseTotal(raw.data.total_number)
    const totalPages = parseTotal(raw.total_page)
    const hasMore = items.length > 0 && (totalPages !== undefined && totalPages > 0
      ? page < totalPages
      : total === undefined || total <= 0 || page * items.length < total)
    return { items, total, totalPages, hasMore }
  }
}
