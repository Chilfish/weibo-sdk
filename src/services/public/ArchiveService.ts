import type { FavoritesResponse } from '../endpoints/favorite'
import type { MyMblogResponse, RepostTimelineResponse } from '../endpoints/tweet'
import type { TweetContractVersion } from '~/types/domain/ITweet'
import { Tweet } from '~/models/data/Tweet'
import { TWEET_CONTRACT_VERSION } from '~/types/domain/ITweet'
import { stripVolatileKeys } from '~/utils/structure'

/**
 * 归档进度类型。
 *
 * `timeline`（用户微博，page 游标）→ `reposts`（逐条转发，page）→ `favorites`（收藏，page）→ `done`
 */
export type ArchivePhase = 'timeline' | 'reposts' | 'favorites' | 'done'

/**
 * 归档进度 checkpoint（A6 断点续传）。
 *
 * 保存最后一个 `ArchiveItem.checkpoint`，中断后传入 `streamArchive` 的 `options.checkpoint` 即可续跑。
 * 粒度说明：reposts 阶段以「整条微博」为断点单位（`lastMblogId` 之后的微博才会处理其转发）；
 * timeline/favorites 以页游标断点。
 */
export interface ArchiveCheckpoint {
  uid: string
  phase: ArchivePhase
  /** timeline 阶段页码游标（下一页页码；恢复时从该页继续） */
  page?: number
  /** reposts 阶段：已处理到的最后一条微博 id（其转发已翻完） */
  lastMblogId?: string
  /** favorites 阶段：当前页 */
  favoritesPage?: number
  /** 已访问的微博 id（幂等/去重参考） */
  visitedMblogIds: string[]
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
  /** 当前阶段页码（timeline / favorites） */
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

/**
 * 单账号归档流（A5）：把 timeline + reposts + favorites 串成一条可恢复的 AsyncIterator。
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
    const cp: ArchiveCheckpoint = options.checkpoint
      ? { ...options.checkpoint, uid }
      : { uid, phase: 'timeline', visitedMblogIds: [] }

    // Phase 1: timeline（raw myMblog，page 游标）
    if (cp.phase === 'timeline' || cp.phase === 'reposts') {
      // checkpoint.page 语义 = 下一页页码（该页 raw 之后的页码；恢复时从该页继续）
      let page = cp.phase === 'timeline' ? (cp.page ?? 1) : 1
      let pages = 0
      while (pages < maxPages) {
        const raw = await this.deps.tweets.myMblog(uid, page, count)
        const list = raw.data.list || []
        for (const item of list) {
          await options.onRaw?.(item, { uid, source: 'timeline', mblogId: item.mblogid, page })
          cp.visitedMblogIds.push(item.mblogid)
          yield {
            schemaVersion: TWEET_CONTRACT_VERSION,
            source: 'timeline',
            mblogId: item.mblogid,
            tweet: new Tweet(item),
            schemaDigest: stripVolatileKeys(item),
            checkpoint: { ...cp, page: page + 1 },
          }
        }
        if (list.length === 0)
          break // 空列表 = 到底（真实 API 翻到底返回 list: []）
        page += 1
        pages += 1
      }
      cp.page = page
      cp.phase = includeReposts ? 'reposts' : (includeFavorites ? 'favorites' : 'done')
    }

    // Phase 2: reposts（对每条 timeline 微博翻转发）
    if (cp.phase === 'reposts' && includeReposts) {
      const timelineIds = await this.collectTimelineMblogIds(uid)
      let skipUntil = cp.lastMblogId
      for (const mblogId of timelineIds) {
        if (skipUntil !== undefined) {
          if (mblogId === skipUntil) {
            skipUntil = undefined // 命中断点，开始处理后续微博
          }
          continue
        }
        let page = 1
        let pages = 0
        while (pages < maxPages) {
          const reposts = await this.deps.tweets.getReposts(mblogId, { page })
          const list = reposts.data || []
          for (const item of list) {
            await options.onRaw?.(item, {
              uid,
              source: 'repost',
              mblogId: item.mblogid,
              page,
              parentMblogId: mblogId,
            })
            cp.visitedMblogIds.push(item.mblogid)
            yield {
              schemaVersion: TWEET_CONTRACT_VERSION,
              source: 'repost',
              mblogId: item.mblogid,
              tweet: new Tweet(item),
              schemaDigest: stripVolatileKeys(item),
              checkpoint: { ...cp, lastMblogId: mblogId },
            }
          }
          cp.lastMblogId = mblogId
          const total = reposts.total_number ?? 0
          const perPage = list.length
          if (page * perPage >= total || perPage === 0)
            break
          page += 1
          pages += 1
        }
      }
      cp.lastMblogId = undefined
      cp.phase = includeFavorites ? 'favorites' : 'done'
    }

    // Phase 3: favorites（page 翻页）
    if (cp.phase === 'favorites' && includeFavorites) {
      let page = cp.favoritesPage ?? 1
      let pages = 0
      while (pages < maxPages) {
        const favs = await this.deps.favorites.getFavorites(uid, page)
        const list = favs.data.status || []
        for (const item of list) {
          await options.onRaw?.(item, { uid, source: 'favorite', mblogId: item.mblogid, page })
          cp.visitedMblogIds.push(item.mblogid)
          yield {
            schemaVersion: TWEET_CONTRACT_VERSION,
            source: 'favorite',
            mblogId: item.mblogid,
            tweet: new Tweet(item),
            schemaDigest: stripVolatileKeys(item),
            checkpoint: { ...cp, favoritesPage: page },
          }
        }
        cp.favoritesPage = page
        const total = favs.data.total_number ?? 0
        const perPage = list.length
        if (page * perPage >= total || perPage === 0)
          break
        page += 1
        pages += 1
      }
      cp.phase = 'done'
    }
  }

  /** 重放 timeline 获取全部微博 id（reposts 阶段用；幂等，可重复调用） */
  private async collectTimelineMblogIds(uid: string): Promise<string[]> {
    const ids: string[] = []
    let page = 1
    let guard = 0
    while (guard < 1000) {
      const raw = await this.deps.tweets.myMblog(uid, page, 20)
      const list = raw.data.list || []
      for (const item of list)
        ids.push(item.mblogid)
      if (list.length === 0)
        break
      page += 1
      guard += 1
    }
    return ids
  }
}
