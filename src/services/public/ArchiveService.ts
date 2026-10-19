import type { FavoritesResponse } from '../endpoints/favorite'
import type { MyMblogResponse, RepostTimelineResponse } from '../endpoints/tweet'
import type { TweetContractVersion } from '~/types/domain/ITweet'
import { Tweet } from '~/models/data/Tweet'
import { TWEET_CONTRACT_VERSION } from '~/types/domain/ITweet'
import { stripVolatileKeys } from '~/utils/structure'

/**
 * 归档进度类型。
 *
 * `timeline`（用户微博 + 内联转发，page 游标）→ `favorites`（收藏，page）→ `done`
 *
 * `reposts` 仅用于兼容 P1-2 之前的旧 checkpoint；新流程不再产生该阶段。
 */
export type ArchivePhase = 'timeline' | 'reposts' | 'favorites' | 'done'

/**
 * 归档进度 checkpoint（A6 断点续传；P1-1/P1-2 后大小恒定）。
 *
 * 保存最后一个 `ArchiveItem.checkpoint`，中断后传入 `streamArchive` 的 `options.checkpoint` 即可续跑。
 *
 * - `page`：timeline **当前页**（恢复时重跑该页）；`lastTimelineMblogId` 用于跳过页内已处理项。
 * - `lastTimelineMblogId`：已完整处理（含其转发）的最后一条微博。
 * - `lastMblogId`：仅兼容旧 `phase:'reposts'` checkpoint，新流程不产生。
 */
export interface ArchiveCheckpoint {
  uid: string
  phase: ArchivePhase
  /** timeline 阶段当前页（恢复时从该页重跑） */
  page?: number
  /** timeline 阶段：已完整处理（含其转发）的最后一条微博 mblogId */
  lastTimelineMblogId?: string
  /** favorites 阶段：当前页 */
  favoritesPage?: number
  /**
   * @deprecated P1-2 之前的 reposts 阶段断点字段；仅用于兼容旧 checkpoint。
   */
  lastMblogId?: string
}

/**
 * 归档流产出项（磁盘条目信封，K1 / P0-1）。
 *
 * `schemaVersion` 为 ITweet 存档契约版本（与包版本解耦），落盘条目据此自描述、
 * 下游可按版本迁移（规则与迁移策略见 docs/engineering/contract-itweet-v1.md）；
 * `tweet` 为归一化模型；`schemaDigest` 为 raw 项的结构快照（A7，`stripVolatileKeys`），
 * 用于检测上游字段漂移（同一源同一时期 digest 应稳定）——注意与契约版本用途不同。
 */
export interface ArchiveItem {
  schemaVersion: TweetContractVersion
  source: 'timeline' | 'repost' | 'favorite'
  mblogId: string
  tweet: Tweet
  schemaDigest: unknown
  checkpoint: ArchiveCheckpoint
}

/**
 * 归档级 raw 回调元数据（P1-9）。
 */
export interface ArchiveRawMeta {
  uid: string
  source: ArchiveItem['source']
  mblogId: string
  /** 当前阶段页码（timeline / reposts / favorites） */
  page?: number
  /** repost 阶段：转发所属原微博 mblogId */
  parentMblogId?: string
}

/**
 * ArchiveService 依赖（注入子 Service，便于离线 mock）。
 * 通过轻量接口隔离，ArchiveService 只编排不直接发请求。
 */
export interface ArchiveServiceDeps {
  tweets: {
    myMblog: (uid: string, page?: number, count?: number) => Promise<MyMblogResponse>
    getReposts: (mblogId: string, options?: { page?: number }) => Promise<RepostTimelineResponse>
  }
  favorites: {
    getFavorites: (uid: string, page?: number) => Promise<FavoritesResponse>
  }
}

export interface ArchiveStreamOptions {
  /** 是否归档每条微博的转发（默认 true） */
  includeReposts?: boolean
  /** 是否归档收藏（默认 true） */
  includeFavorites?: boolean
  /** 每页条数（timeline 阶段，默认 20） */
  count?: number
  /** 每阶段最多翻页数（测试/演示限制，默认不限） */
  maxPagesPerPhase?: number
  /** 断点续传：传入上次保存的 checkpoint */
  checkpoint?: ArchiveCheckpoint
  /**
   * 归档级 raw 回调（P1-9）：每个原始微博项在归一化前触发。
   *
   * `raw` 为上游原始 JSON（未校验），下游自行落盘；`ArchiveItem` 不携带 raw。
   */
  onRaw?: (raw: unknown, meta: ArchiveRawMeta) => void | Promise<void>
}

/** 单页内按 mblogid 去重（保持上游顺序）。 */
function uniqueByMblogId<T extends { mblogid: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of list) {
    if (seen.has(item.mblogid))
      continue
    seen.add(item.mblogid)
    out.push(item)
  }
  return out
}

/**
 * 整页重复保护：所有 id 都出现在上一页 → 上游忽略了 page/游标，视为到底。
 * 避免上游重复返回同一页时无限翻页。
 */
function isRepeatedPage(ids: string[], previousPageIds: Set<string>): boolean {
  return ids.length > 0 && ids.every(id => previousPageIds.has(id))
}

/**
 * 单账号归档流（A5）：把 timeline（内联转发）+ favorites 串成一条可恢复的 AsyncIterator。
 *
 * 用法（≤20 行镜像单账号）：
 * ```ts
 * for await (const item of sdk.archive.streamArchive(uid)) {
 *   await persist(item.tweet)        // 落盘
 *   lastCheckpoint = item.checkpoint // 保存进度，中断后可续传
 * }
 * ```
 */
export class ArchiveService {
  constructor(private deps: ArchiveServiceDeps) {}

  async* streamArchive(uid: string, options: ArchiveStreamOptions = {}): AsyncIterableIterator<ArchiveItem> {
    const includeReposts = options.includeReposts ?? true
    const includeFavorites = options.includeFavorites ?? true
    const maxPages = options.maxPagesPerPhase ?? Number.POSITIVE_INFINITY
    const count = options.count ?? 20
    // 只复制已知字段：旧 checkpoint 可能含 visitedMblogIds 等历史字段，避免它们回流。
    const input = options.checkpoint
    let phase: ArchivePhase = input?.phase ?? 'timeline'
    let page = input?.page
    let lastTimelineMblogId = input?.lastTimelineMblogId
    let favoritesPage = input?.favoritesPage

    // 旧 checkpoint 的 page 语义是「下一页」，新语义是「当前页」：倒退一页重跑，避免漏项。
    const legacyVisited = (input as { visitedMblogIds?: unknown } | undefined)?.visitedMblogIds
    if (legacyVisited !== undefined && phase === 'timeline' && page !== undefined)
      page = Math.max(1, page - 1)

    // P1-2 兼容：旧 reposts 阶段等价于「timeline 已处理到 lastMblogId」，新流程内联转发。
    if (phase === 'reposts') {
      phase = 'timeline'
      page = 1
      lastTimelineMblogId = input?.lastMblogId ?? lastTimelineMblogId
    }

    const cp: ArchiveCheckpoint = { uid, phase, page, lastTimelineMblogId, favoritesPage }

    // Phase 1: timeline（mymblog page 游标；转发内联，P1-2）
    if (phase === 'timeline') {
      let currentPage = page ?? 1
      let pages = 0
      let previousPageIds = new Set<string>()

      while (pages < maxPages) {
        const raw = await this.deps.tweets.myMblog(uid, currentPage, count)
        const list = uniqueByMblogId(raw.data.list || [])
        const ids = list.map(item => item.mblogid)
        if (ids.length === 0)
          break // 空列表 = 到底（真实 API 翻到底返回 list: []）
        if (isRepeatedPage(ids, previousPageIds))
          break // 上游忽略 page 重复返回上一页 → 视为到底

        // 恢复：跳过上次已完整处理（含转发）的项；找不到则整页重跑（重复但不会漏）。
        const resumeAt = lastTimelineMblogId ? ids.indexOf(lastTimelineMblogId) : -1
        const pending = resumeAt >= 0 ? list.slice(resumeAt + 1) : list

        for (const item of pending) {
          await options.onRaw?.(item, { uid, source: 'timeline', mblogId: item.mblogid, page: currentPage })

          cp.phase = 'timeline'
          cp.page = currentPage
          cp.favoritesPage = undefined
          // 转发完成前仍指向上一条已完成项；中断会重跑当前项（重复但不会漏）。
          cp.lastTimelineMblogId = includeReposts ? lastTimelineMblogId : item.mblogid
          yield {
            schemaVersion: TWEET_CONTRACT_VERSION,
            source: 'timeline',
            mblogId: item.mblogid,
            tweet: new Tweet(item),
            schemaDigest: stripVolatileKeys(item),
            checkpoint: { ...cp },
          }

          if (includeReposts) {
            let repostPage = 1
            let repostPages = 0
            let previousRepostIds = new Set<string>()

            while (repostPages < maxPages) {
              const reposts = await this.deps.tweets.getReposts(item.mblogid, { page: repostPage })
              const rawReposts = reposts.data || []
              const repostList = uniqueByMblogId(rawReposts)
              const repostIds = repostList.map(repost => repost.mblogid)
              if (repostIds.length === 0)
                break
              if (isRepeatedPage(repostIds, previousRepostIds))
                break

              for (const repost of repostList) {
                await options.onRaw?.(repost, {
                  uid,
                  source: 'repost',
                  mblogId: repost.mblogid,
                  page: repostPage,
                  parentMblogId: item.mblogid,
                })
                yield {
                  schemaVersion: TWEET_CONTRACT_VERSION,
                  source: 'repost',
                  mblogId: repost.mblogid,
                  tweet: new Tweet(repost),
                  schemaDigest: stripVolatileKeys(repost),
                  checkpoint: { ...cp },
                }
              }

              previousRepostIds = new Set(repostIds)
              const total = reposts.total_number ?? 0
              const perPage = rawReposts.length
              if (repostPage * perPage >= total || perPage === 0)
                break
              repostPage += 1
              repostPages += 1
            }
          }

          lastTimelineMblogId = item.mblogid
          cp.lastTimelineMblogId = lastTimelineMblogId
        }

        previousPageIds = new Set(ids)
        currentPage += 1
        pages += 1
      }

      page = currentPage
      phase = includeFavorites ? 'favorites' : 'done'
      lastTimelineMblogId = undefined
      cp.phase = phase
      cp.page = undefined
      cp.lastTimelineMblogId = undefined
      cp.favoritesPage = includeFavorites ? (favoritesPage ?? 1) : undefined
      favoritesPage = cp.favoritesPage
    }

    // Phase 2: favorites（page 翻页）
    if (phase === 'favorites' && includeFavorites) {
      let currentPage = favoritesPage ?? 1
      let pages = 0
      let previousPageIds = new Set<string>()

      while (pages < maxPages) {
        const favs = await this.deps.favorites.getFavorites(uid, currentPage)
        const rawFavorites = favs.data.status || []
        const list = uniqueByMblogId(rawFavorites)
        const ids = list.map(item => item.mblogid)
        if (ids.length === 0)
          break
        if (isRepeatedPage(ids, previousPageIds))
          break

        for (const item of list) {
          await options.onRaw?.(item, { uid, source: 'favorite', mblogId: item.mblogid, page: currentPage })

          cp.phase = 'favorites'
          cp.page = undefined
          cp.lastTimelineMblogId = undefined
          cp.favoritesPage = currentPage
          yield {
            schemaVersion: TWEET_CONTRACT_VERSION,
            source: 'favorite',
            mblogId: item.mblogid,
            tweet: new Tweet(item),
            schemaDigest: stripVolatileKeys(item),
            checkpoint: { ...cp },
          }
        }

        previousPageIds = new Set(ids)
        const total = favs.data.total_number ?? 0
        const perPage = rawFavorites.length
        if (currentPage * perPage >= total || perPage === 0)
          break
        currentPage += 1
        pages += 1
      }

      cp.phase = 'done'
    }
  }
}
