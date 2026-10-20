import type { RawTweet } from '~/models/data/Tweet'
import type { IWeiboConfig } from '~/types/config'
import { isRawTweet, Tweet } from '~/models/data/Tweet'
import { likeListSpec } from '../endpoints/like'
import { FetcherService } from '../internal/FetcherService'

/** 一页「我赞过的微博」的归一化结果（`listByUserId` 返回值）。 */
export interface LikePageResult {
  /** 下一页页码（page 游标，从 1 开始） */
  page: number
  /**
   * 是否可能还有下一页。
   *
   * 上游只返回 `data.list`（无 `total` / `total_page` / `hasMore` / `cursor`），
   * 因此只能按「本页去重后是否有条目」判断；越界页返回 `list: []`，即 `false`。
   */
  hasMore: boolean
  /** 本页归一化后的微博（已按 `mblogid` 去重） */
  tweets: Tweet[]
}

/** `listByUserId` 的选项。 */
export interface LikeListOptions {
  /** 页码（从 1 开始；缺省 = 第一页；`< 1` / 非有限数按第一页处理，不会发 `page=0`） */
  page?: number
}

/** 点赞流进度（每页触发一次）。 */
export interface LikeStreamProgress {
  /** 点赞所属用户 UID */
  uid: string
  /** 当前页码（1 基） */
  page: number
  /** 已产出的微博数（跨页去重后） */
  processed: number
  /** 本页去重后的条目数（含已被跨页去重过滤掉的重复项） */
  pageSize: number
}

/** `streamByUserId` 的选项。 */
export interface LikeStreamOptions extends LikeListOptions {
  /** 最多翻页数（默认不限；非有限数按不限处理，`<= 0` 视为不翻页） */
  maxPages?: number
  /** 每页进度回调；异常不会中断流 */
  onProgress?: (progress: LikeStreamProgress) => void | Promise<void>
}

/**
 * 页码归一化：只接受 `>= 1` 的有限数；其余（`0` / 负数 / `NaN` / `Infinity`）按第一页处理。
 *
 * 上游 `page=0` 与 `page=1` 等价，但为避免把非法值透传给上游（也避免 `page=0` 的歧义），
 * 统一归一到 1，保证请求参数恒为合法正整数。
 */
function normalizePage(page?: number): number {
  if (page === undefined || !Number.isFinite(page))
    return 1
  const normalized = Math.floor(page)
  return normalized >= 1 ? normalized : 1
}

/** 翻页上限归一化：缺省 / 非有限数 = 不限；其余取非负整数。 */
function normalizeMaxPages(maxPages?: number): number {
  if (maxPages === undefined || !Number.isFinite(maxPages))
    return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(maxPages))
}

/**
 * 单页内按 `mblogid` 去重（保持上游顺序），同时用 `isRawTweet` 做类型诚实收窄。
 *
 * `likeListSpec.schema` 已保证 `mblogid` 为 string，这里的 guard 只用于把 `unknown`
 * 收窄成 `RawTweet`（避免 `as any`），并作为纵深防御跳过异常条目。
 */
function uniqueRawTweets(items: readonly unknown[]): RawTweet[] {
  const seen = new Set<string>()
  const out: RawTweet[] = []
  for (const item of items) {
    if (!isRawTweet(item) || seen.has(item.mblogid))
      continue
    seen.add(item.mblogid)
    out.push(item)
  }
  return out
}

/**
 * 「我赞过的微博」领域服务。
 *
 * 端点 `GET https://weibo.com/ajax/statuses/likelist?uid=<uid>&page=<n>`（page 型分页）：
 * 真实响应只有 `{ ok: 1, data: { list: 微博[] } }`，**无 total / hasMore / cursor**，
 * 每页约 18 条；`page=0` 与 `page=1` 等价，越界页返回 200 + `list: []`。
 *
 * 因此 `listByUserId` / `streamByUserId` 的分页完全依赖「本页是否为空」，
 * 并用跨页 `mblogid` 去重兜底上游忽略 `page` 的场景（会返回整页重复）。
 */
export class LikeService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取并归一化一页「我赞过的微博」（page 游标）。
   *
   * 上游没有 total / hasMore：`hasMore` 只能按「本页去重后是否有条目」判断，
   * 跨页去重与停止判定由 `streamByUserId` 负责。
   *
   * @param uid 点赞所属用户 UID（通常是登录用户）
   * @param options 分页选项
   * @param options.page 页码（从 1 开始，缺省 1；`< 1` / 非有限数按第一页处理，不会发 `page=0`）
   * @returns 归一化后的本页微博 + **下一页**页码；本页无条目时 `hasMore` 为 `false`
   * @throws `WeiboAPINotOkError`（`ok !== 1`）/ `UnexpectedAPIResponseError`（schema 校验失败）/ 传输层错误
   */
  public async listByUserId(uid: string, options: LikeListOptions = {}): Promise<LikePageResult> {
    const page = normalizePage(options.page)
    const raw = await this.request(likeListSpec, { uid, page })
    const items = uniqueRawTweets(raw.data.list ?? [])

    const startAt = Date.now()
    const tweets = items.map(item => new Tweet(item))
    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'Tweet',
      count: tweets.length,
      duration_ms: Date.now() - startAt,
    })

    return {
      page: page + 1,
      hasMore: items.length > 0,
      tweets,
    }
  }

  /**
   * 流式获取「我赞过的微博」（自动翻页 + 跨页去重）。
   *
   * 停止条件（任一命中即停）：
   * 1. 空页（`data.list` 为空——越界页也是这种形态）；
   * 2. 整页重复（上游忽略 `page`，返回的 `mblogid` 全部已见过）；
   * 3. 达到 `maxPages`。
   *
   * `onProgress` 每页触发一次（`processed` 为跨页去重后的累计产出数），回调抛错会被吞掉，
   * 不影响流；单页请求失败（`WeiboAPINotOkError` / `UnexpectedAPIResponseError` / 传输层错误）
   * 会直接抛出，已产出的条目由调用方自行保存。
   *
   * @param uid 点赞所属用户 UID
   * @param options 翻页选项
   * @param options.page 起始页码（从 1 开始，缺省 1；`< 1` / 非有限数按第一页处理）
   * @param options.maxPages 最多翻页数（**默认不限**；非有限数按不限处理，`<= 0` 视为不翻页）
   * @param options.onProgress 每页进度回调；异常不会中断流
   *
   * @example
   * for await (const tweet of sdk.likes.streamByUserId('7679065628', { maxPages: 3 })) {
   *   console.log(tweet.mblogId, tweet.text)
   * }
   */
  async* streamByUserId(uid: string, options: LikeStreamOptions = {}): AsyncIterableIterator<Tweet> {
    const maxPages = normalizeMaxPages(options.maxPages)
    let page = normalizePage(options.page)
    let pages = 0
    let processed = 0
    const seen = new Set<string>()

    while (pages < maxPages) {
      const items = await this.fetchLikePage(uid, page)
      if (items.length === 0)
        break // 空页：越界 / 赞过为空，均视为到底

      const fresh = items.filter(item => !seen.has(item.mblogid))
      if (fresh.length === 0)
        break // 整页重复：上游忽略了 page，视为到底

      for (const item of fresh)
        seen.add(item.mblogid)

      const startAt = Date.now()
      for (const item of fresh) {
        processed += 1
        yield new Tweet(item)
      }
      await this.emitTelemetry({
        event_name: 'normalize_done',
        timestamp: Date.now(),
        trace_id: this.newTraceId(),
        model: 'Tweet',
        count: fresh.length,
        duration_ms: Date.now() - startAt,
      })

      try {
        await options.onProgress?.({ uid, page, processed, pageSize: items.length })
      }
      catch {
        // 进度回调异常不影响流
      }

      page += 1
      pages += 1
    }
  }

  /**
   * 拉取一页并做单页去重（`mblogid`）。
   *
   * 注意：`yield` 不能出现在 `try/catch`（含 try/finally）里做 `await` 之后，
   * 因此去重与请求抽到这里，`streamByUserId` 只负责产出与停止判定。
   */
  private async fetchLikePage(uid: string, page: number): Promise<RawTweet[]> {
    const raw = await this.request(likeListSpec, { uid, page })
    return uniqueRawTweets(raw.data.list ?? [])
  }
}
