import type { ArchiveItem } from '../../public/ArchiveService'
import type { ArchiveRuntime } from '../runtime'
import { isRepeatedPage, uniqueByMblogId } from '../utils'

/** likes 阶段：page 翻页（上游无 total）。 */
export async function* streamLikes(runtime: ArchiveRuntime): AsyncGenerator<ArchiveItem, void, undefined> {
  const likesDep = runtime.likes
  if (!likesDep)
    return

  const { cp, uid, options, maxPages, state } = runtime
  let currentPage = state.likesPage ?? 1
  let pages = 0
  let previousPageIds = new Set<string>()

  while (pages < maxPages) {
    const raw = await runtime.runWithPolicy(
      () => likesDep(uid, currentPage),
      { stage: 'likes', source: 'like', page: currentPage },
      runtime.likesErrorPolicy,
    )
    if (!raw)
      break
    const list = uniqueByMblogId(raw.data.list || [])
    const ids = list.map(item => item.mblogid)
    if (ids.length === 0)
      break // 空页 = 到底（上游越界页返回 list: []）
    if (isRepeatedPage(ids, previousPageIds))
      break // 上游忽略 page 重复返回同一页

    for (const item of list) {
      await options.onRaw?.(item, { uid, source: 'like', mblogId: item.mblogid, page: currentPage })

      cp.phase = 'likes'
      cp.page = undefined
      cp.lastTimelineMblogId = undefined
      cp.favoritesPage = undefined
      cp.likesPage = currentPage
      delete cp.commentHistoryCursor
      delete cp.sliceEnd
      delete cp.slicePage
      delete cp.sliceWindow
      const tweet = await runtime.prepareTweet(item, 'like', currentPage)
      runtime.progress.processed += 1
      yield runtime.buildItem(item, 'like', cp, tweet)
    }

    previousPageIds = new Set(ids)
    await runtime.reportProgress({ source: 'likes', page: currentPage })
    state.likesPage = currentPage + 1
    currentPage += 1
    pages += 1
  }
}
