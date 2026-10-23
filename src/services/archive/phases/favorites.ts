import type { ArchiveItem } from '../../public/ArchiveService'
import type { ArchiveRuntime } from '../runtime'
import { isRepeatedPage, uniqueByMblogId } from '../utils'

/** favorites 阶段：page 翻页。 */
export async function* streamFavorites(runtime: ArchiveRuntime): AsyncGenerator<ArchiveItem, void, undefined> {
  const { cp, uid, options, maxPages, state } = runtime
  let currentPage = state.favoritesPage ?? 1
  let pages = 0
  let previousPageIds = new Set<string>()

  while (pages < maxPages) {
    const favs = await runtime.runWithPolicy(
      () => runtime.deps.favorites.fetchRawFavorites(uid, currentPage),
      { stage: 'favorites', source: 'favorite', page: currentPage },
      'abort',
    )
    if (!favs)
      break
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
      delete cp.likesPage
      delete cp.commentHistoryCursor
      const tweet = await runtime.prepareTweet(item, 'favorite', currentPage)
      runtime.progress.processed += 1
      yield runtime.buildItem(item, 'favorite', cp, tweet)
    }

    previousPageIds = new Set(ids)
    const total = favs.data.total_number ?? 0
    const perPage = rawFavorites.length
    await runtime.reportProgress({
      source: 'favorites',
      total,
      remaining: Math.max(0, total - currentPage * perPage),
      page: currentPage,
    })
    if (currentPage * perPage >= total || perPage === 0)
      break
    currentPage += 1
    state.favoritesPage = currentPage
    pages += 1
  }
}
