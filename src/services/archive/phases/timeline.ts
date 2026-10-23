import type { SearchProfileResponse } from '../../endpoints/tweet'
import type { ArchiveItem } from '../../public/ArchiveService'
import type { ArchiveRuntime, PreparedTimelineItem } from '../runtime'
import type { TimelineRawItem } from '../utils'
import { Tweet } from '~/models/data/Tweet'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { streamReposts } from '../reposts'
import {
  DEFAULT_SLICE_WINDOW,
  isRepeatedPage,
  MAX_SLICE_PAGE_REPRIMES,
  MAX_SLICE_WINDOW,
  MIN_SLICE_WINDOW,
  parseCreatedAt,
  parseTotal,
  uniqueByMblogId,
} from '../utils'

/** `streamTimeline` 的逐条过滤结果。 */
type TimelineAction = 'emit' | 'skip' | 'stop'

/**
 * timeline 阶段：mymblog（page 游标）→ searchProfile 日期切片。
 *
 * 两者只差游标字段，统一走 `processTimelinePage`，避免两份逻辑手工同步。
 */
export async function* streamTimeline(runtime: ArchiveRuntime): AsyncGenerator<ArchiveItem, void, undefined> {
  const { state, cp, options, uid } = runtime
  const input = options.checkpoint
  const searchByDate = runtime.searchByDate
  const { maxPages, count, concurrency, since, maxSliceItems } = runtime

  const startedFromBeginning = input?.page === undefined
    && input?.lastTimelineMblogId === undefined
    && input?.sliceEnd === undefined

  await runtime.reportProgress({ source: runtime.timelineSource === 'search' ? 'search' : 'mymblog' })

  let oldestTimelineTs: number | undefined
  let mymblogTotal: number | undefined
  let mymblogSeen = 0

  /**
   * 处理一页 timeline 项：滑窗预取 → 逐项产出 → 评论挂载 → 转发流 → 断点推进。
   */
  async function* processTimelinePage(
    items: TimelineRawItem[],
    actions: TimelineAction[],
    limit: number,
    page: number,
    pageState: { lastId: string | undefined },
    writeCursor: (lastCompletedId: string | undefined) => void,
  ): AsyncGenerator<ArchiveItem, void, undefined> {
    const prepared = new Map<number, PreparedTimelineItem>()
    /** 滑窗预取：当前项开始等待时，后 N-1 项的独立子请求已经在路上。 */
    const prefetch = (index: number): void => {
      const end = Math.min(limit, index + concurrency)
      for (let offset = index; offset < end; offset++) {
        if (actions[offset] !== 'emit' || prepared.has(offset))
          continue
        prepared.set(offset, runtime.startTimelineItem(items[offset], page))
      }
    }

    try {
      for (let index = 0; index < items.length; index++) {
        if (index >= limit) {
          state.incrementalReached = true
          break
        }
        const item = items[index]
        if (actions[index] === 'skip') {
          // 跳过但推进断点，避免下次从头重复扫描。
          writeCursor(item.mblogid)
          pageState.lastId = item.mblogid
          continue
        }

        await options.onRaw?.(item, { uid, source: 'timeline', mblogId: item.mblogid, page })

        prefetch(index)

        // 转发完成前仍指向上一条已完成项；中断会重跑当前项（重复但不会漏）。
        writeCursor(runtime.includeReposts ? pageState.lastId : item.mblogid)
        const task = prepared.get(index)!
        const tweet = new Tweet(item)
        const comments = await task.comments
        if (comments.length > 0)
          tweet.comments = comments
        runtime.progress.processed += 1
        yield runtime.buildItem(item, 'timeline', cp, tweet)

        if (runtime.includeReposts)
          yield* streamReposts(runtime, item, task.firstRepostPage)

        pageState.lastId = item.mblogid
        state.lastTimelineMblogId = pageState.lastId
        writeCursor(pageState.lastId)
      }
    }
    finally {
      await runtime.settlePrepared(prepared)
    }
  }

  // Phase 1a: mymblog（page 游标；转发内联，P1-2）
  // 已进入日期切片阶段（sliceEnd 存在）时不重跑 mymblog。
  if (runtime.timelineSource === 'mymblog' && input?.sliceEnd === undefined) {
    let currentPage = state.page ?? 1
    let pages = 0
    let previousPageIds = new Set<string>()

    while (pages < maxPages) {
      const raw = await runtime.runWithPolicy(
        () => runtime.deps.tweets.fetchRawUserTimelinePage(uid, currentPage, count),
        { stage: 'timeline', source: 'timeline', page: currentPage },
        'abort',
      )
      if (!raw)
        break
      const list = uniqueByMblogId(raw.data.list || [])
      const ids = list.map(item => item.mblogid)
      if (ids.length === 0)
        break // 空列表 = 到底（真实 API 翻到底返回 list: []）
      if (isRepeatedPage(ids, previousPageIds))
        break // 上游忽略 page 重复返回上一页 → 视为到底

      const total = parseTotal(raw.data.total)
      if (total !== undefined && total > 0)
        mymblogTotal = Math.max(mymblogTotal ?? 0, total)
      mymblogSeen += list.length
      for (const item of list) {
        const ts = parseCreatedAt(item.created_at)
        if (ts !== undefined && (oldestTimelineTs === undefined || ts < oldestTimelineTs))
          oldestTimelineTs = ts
      }

      // 恢复：跳过上次已完整处理（含转发）的项；找不到则整页重跑（重复但不会漏）。
      const resumeAt = state.lastTimelineMblogId ? ids.indexOf(state.lastTimelineMblogId) : -1
      const pending = resumeAt >= 0 ? list.slice(resumeAt + 1) : list
      // skip / stop 是纯判定，先算出可预取范围，避免提前推进 checkpoint。
      const actions = pending.map(item => runtime.incrementalAction(item))
      const stopAt = actions.indexOf('stop')
      const limit = stopAt >= 0 ? stopAt : pending.length
      const pageState = { lastId: state.lastTimelineMblogId }

      yield* processTimelinePage(pending, actions, limit, currentPage, pageState, (lastCompletedId) => {
        cp.phase = 'timeline'
        cp.page = currentPage
        cp.favoritesPage = undefined
        delete cp.sliceEnd
        delete cp.slicePage
        delete cp.sliceWindow
        cp.lastTimelineMblogId = lastCompletedId
      })

      state.lastTimelineMblogId = pageState.lastId

      if (state.incrementalReached)
        break

      previousPageIds = new Set(ids)
      await runtime.reportProgress({
        source: 'mymblog',
        total: mymblogTotal,
        remaining: mymblogTotal !== undefined ? Math.max(0, mymblogTotal - mymblogSeen) : undefined,
        page: currentPage,
      })
      currentPage += 1
      pages += 1
    }

    state.page = currentPage
  }

  // Phase 1b: searchProfile 日期切片（P1-5）
  if (searchByDate && !state.incrementalReached) {
    const canSlice = runtime.timelineSource === 'search'
      || (runtime.includeDateSlices && oldestTimelineTs !== undefined)

    // 仅当能证明 mymblog 已完整时跳过回填；否则宁可多扫一遍更早区间，也不漏数据。
    const mymblogLooksComplete = startedFromBeginning
      && mymblogTotal !== undefined
      && mymblogSeen >= mymblogTotal

    const resumeSliceEnd = input?.sliceEnd
    let sliceEnd = resumeSliceEnd
    if (sliceEnd === undefined && runtime.timelineSource === 'search') {
      sliceEnd = options.until ?? Math.floor(Date.now() / 1000)
    }
    else if (sliceEnd === undefined && canSlice && oldestTimelineTs !== undefined && !mymblogLooksComplete) {
      sliceEnd = oldestTimelineTs - 1
    }

    let sliceWindow = input?.sliceWindow ?? options.sliceWindow ?? DEFAULT_SLICE_WINDOW
    let slicePage = input?.slicePage
    let sliceLastId = resumeSliceEnd !== undefined ? state.lastTimelineMblogId : undefined
    let pages = 0

    while (sliceEnd !== undefined && sliceEnd >= since && pages < maxPages) {
      const sliceStart = Math.max(since, sliceEnd - sliceWindow + 1)

      const fetchSlicePage = (page: number): Promise<SearchProfileResponse | undefined> => runtime.runWithPolicy(
        () => searchByDate(uid, {
          page,
          ...(options.searchQuery === undefined ? {} : { q: options.searchQuery }),
          starttime: sliceStart,
          endtime: sliceEnd,
        }),
        { stage: 'timeline', source: 'timeline', page },
        'abort',
      )

      const first = await fetchSlicePage(1)
      if (!first)
        break
      const firstList = uniqueByMblogId(first.data.list || [])
      let total = parseTotal(first.data.total)

      // 空切片：直接跨过，并扩大窗口加速扫描长期无内容的区间。
      if (firstList.length === 0 && (total === undefined || total <= 0)) {
        sliceEnd = sliceStart - 1
        sliceWindow = Math.min(MAX_SLICE_WINDOW, sliceWindow * 2)
        continue
      }

      // 切片太密：分页会触达上游 window 上限。缩小窗口后重试同一区间，
      // 优先处理靠前的（较新）子区间，避免整段漏数据。
      if (total !== undefined && total > maxSliceItems && sliceWindow > MIN_SLICE_WINDOW) {
        sliceWindow = Math.max(MIN_SLICE_WINDOW, Math.floor(sliceWindow / 2))
        continue
      }

      let currentPage = slicePage ?? 1
      let previousPageIds = new Set<string>()
      let previousFirstTs: number | undefined
      let collected = 0
      const resumePage = currentPage
      let currentLastId = sliceLastId
      let reprimes = 0

      while (pages < maxPages) {
        const response = currentPage === 1 ? first : await fetchSlicePage(currentPage)
        if (!response)
          break
        const list = uniqueByMblogId(response.data.list || [])
        const ids = list.map(item => item.mblogid)
        const firstTs = parseCreatedAt(list[0]?.created_at)

        // searchProfile 的 page>1 复用会话里最近一次 page=1 的窗口（starttime/endtime 被忽略）。
        // 窗口被别的查询覆盖时会返回别的日期区间；重新请求 page=1 恢复会话后重试当前页。
        if (currentPage > 1) {
          const pageTotal = parseTotal(response.data.total)
          const totalMoved = total !== undefined && pageTotal !== undefined && pageTotal !== total
          const wentOlderThanWindow = list.some((item) => {
            const itemTs = parseCreatedAt(item.created_at)
            return itemTs !== undefined && itemTs < sliceStart
          })
          const emptyWithRemaining = ids.length === 0 && total !== undefined && collected < total
          const clobbered = wentOlderThanWindow || (totalMoved && ids.length > 0)

          if (clobbered || emptyWithRemaining) {
            if (reprimes < MAX_SLICE_PAGE_REPRIMES) {
              reprimes += 1
              const primed = await fetchSlicePage(1)
              if (!primed)
                break
              // total 也可能因删除/新增真实漂移，priming 时一并刷新，避免误判。
              const primedTotal = parseTotal(primed.data.total)
              if (primedTotal !== undefined)
                total = primedTotal
              continue
            }
            if (clobbered) {
              throw new UnexpectedAPIResponseError(
                'searchProfile pagination returned another date window; the session was clobbered by a concurrent query.',
                {
                  endpoint: 'ajax/statuses/searchProfile',
                  uid,
                  page: currentPage,
                  sliceStart,
                  sliceEnd,
                  expectedTotal: total,
                  actualTotal: pageTotal,
                  mblogIds: ids.slice(0, 3),
                },
              )
            }
            // 空页且 total 仍声称有剩余：按上游 total 高估处理，保留「到底」语义。
            break
          }
        }

        if (ids.length === 0)
          break
        if (currentPage > 1 && isRepeatedPage(ids, previousPageIds))
          break
        // 上游 page 越界后会重置到较新的区间：日期不再变旧 → 视为到底，避免重复/漏页。
        if (currentPage > 1 && previousFirstTs !== undefined && firstTs !== undefined && firstTs > previousFirstTs)
          break
        if (currentPage > 1)
          reprimes = 0

        // 恢复：只在进入续跑页时按 lastTimelineMblogId 跳过已处理项。
        const resumeAt = currentLastId && currentPage === resumePage ? ids.indexOf(currentLastId) : -1
        const pending = resumeAt >= 0 ? list.slice(resumeAt + 1) : list
        const actions = pending.map(item => runtime.incrementalAction(item))
        const stopAt = actions.indexOf('stop')
        const limit = stopAt >= 0 ? stopAt : pending.length
        const pageState = { lastId: currentLastId }

        yield* processTimelinePage(pending, actions, limit, currentPage, pageState, (lastCompletedId) => {
          cp.phase = 'timeline'
          cp.page = undefined
          cp.favoritesPage = undefined
          cp.sliceEnd = sliceEnd
          cp.slicePage = currentPage
          cp.sliceWindow = sliceWindow
          cp.lastTimelineMblogId = lastCompletedId
        })

        currentLastId = pageState.lastId

        if (state.incrementalReached)
          break

        collected += list.length
        previousPageIds = new Set(ids)
        previousFirstTs = firstTs ?? previousFirstTs
        await runtime.reportProgress({
          source: 'search',
          total,
          remaining: total !== undefined ? Math.max(0, total - collected) : undefined,
          page: currentPage,
        })

        if (total !== undefined && total > 0 && collected >= total)
          break

        currentPage += 1
        pages += 1
      }

      if (state.incrementalReached)
        break

      pages += 1
      sliceEnd = sliceStart - 1
      slicePage = 1
      sliceLastId = undefined
      // 内容稀疏时逐步放大窗口；遇到密集区间会自动再缩小。
      if (total !== undefined && total < maxSliceItems / 8)
        sliceWindow = Math.min(MAX_SLICE_WINDOW, sliceWindow * 2)

      cp.sliceEnd = sliceEnd
      cp.slicePage = slicePage
      cp.sliceWindow = sliceWindow
      cp.lastTimelineMblogId = undefined
      cp.page = undefined
      state.sliceEnd = sliceEnd
      state.slicePage = slicePage
      state.sliceWindow = sliceWindow
      state.lastTimelineMblogId = undefined
    }

    if (sliceEnd !== undefined)
      state.sliceEnd = sliceEnd
    state.slicePage = slicePage
    state.sliceWindow = sliceWindow
    state.lastTimelineMblogId = undefined
    state.page = undefined
  }
}
