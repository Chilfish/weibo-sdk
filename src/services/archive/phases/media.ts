import type { ArchiveItem } from '../../public/ArchiveService'
import type { ArchiveRuntime } from '../runtime'
import { normalizeImageWallItem, normalizeWaterfallVideo } from '~/models/data/Media'
import { Tweet } from '~/models/data/Tweet'
import { normalizeCursorString } from '../utils'

/** images 阶段：图片墙（since_id 游标）。 */
export async function* streamImages(runtime: ArchiveRuntime): AsyncGenerator<ArchiveItem, void, undefined> {
  const imagePageDep = runtime.images
  if (!imagePageDep)
    return

  const { cp, uid, options, maxPages, state } = runtime
  let cursor = state.imagesCursor
  let pages = 0
  const seen = new Set<string>()

  while (pages < maxPages) {
    const raw = await runtime.runWithPolicy(
      () => imagePageDep(uid, cursor === undefined ? {} : { sinceId: cursor }),
      { stage: 'images', source: 'image', page: pages + 1 },
      runtime.imagesErrorPolicy,
    )
    if (!raw)
      break

    const rawList = raw.data.list || []
    if (rawList.length === 0)
      break
    const nextCursor = normalizeCursorString(raw.data.since_id)

    for (const rawItem of rawList) {
      const asset = normalizeImageWallItem(rawItem)
      if (!asset.id || seen.has(asset.id))
        continue
      seen.add(asset.id)

      const mblogId = asset.sourceMblogId ?? asset.sourceTweetId ?? asset.id
      await options.onRaw?.(rawItem, { uid, source: 'image', mblogId, page: pages + 1 })

      cp.phase = 'images'
      cp.page = undefined
      cp.lastTimelineMblogId = undefined
      cp.favoritesPage = undefined
      delete cp.likesPage
      delete cp.commentHistoryCursor
      delete cp.sliceEnd
      delete cp.slicePage
      delete cp.sliceWindow
      delete cp.videosCursor
      if (cursor !== undefined)
        cp.imagesCursor = cursor
      else
        delete cp.imagesCursor

      runtime.progress.processed += 1
      yield runtime.buildMediaItem(rawItem, 'image', cp, asset, mblogId)
    }

    pages += 1
    await runtime.reportProgress({ source: 'images', page: pages })

    // 全页重复但游标还在前进时继续翻页；游标不动才是到底。
    if (nextCursor === undefined || nextCursor === cursor)
      break
    cursor = nextCursor
    state.imagesCursor = nextCursor
  }
}

/** videos 阶段：视频瀑布（cursor 游标；条目本身是微博）。 */
export async function* streamVideos(runtime: ArchiveRuntime): AsyncGenerator<ArchiveItem, void, undefined> {
  const videoPageDep = runtime.videos
  if (!videoPageDep)
    return

  const { cp, uid, options, maxPages, state } = runtime
  let cursor = state.videosCursor
  let pages = 0
  const seen = new Set<string>()

  while (pages < maxPages) {
    const raw = await runtime.runWithPolicy(
      () => videoPageDep(uid, cursor === undefined ? {} : { cursor }),
      { stage: 'videos', source: 'video', page: pages + 1 },
      runtime.videosErrorPolicy,
    )
    if (!raw)
      break

    const rawList = raw.data.list || []
    if (rawList.length === 0)
      break
    const nextCursor = normalizeCursorString(raw.data.next_cursor)

    for (const rawItem of rawList) {
      const asset = normalizeWaterfallVideo(rawItem)
      if (!asset || seen.has(asset.id))
        continue
      seen.add(asset.id)

      const mblogId = rawItem.mblogid
      await options.onRaw?.(rawItem, { uid, source: 'video', mblogId, page: pages + 1 })

      cp.phase = 'videos'
      cp.page = undefined
      cp.lastTimelineMblogId = undefined
      cp.favoritesPage = undefined
      delete cp.likesPage
      delete cp.commentHistoryCursor
      delete cp.sliceEnd
      delete cp.slicePage
      delete cp.sliceWindow
      delete cp.imagesCursor
      if (cursor !== undefined)
        cp.videosCursor = cursor
      else
        delete cp.videosCursor

      const tweet = new Tweet(rawItem)
      const item = runtime.buildItem(rawItem, 'video', cp, tweet)
      item.asset = asset
      runtime.progress.processed += 1
      yield item
    }

    pages += 1
    await runtime.reportProgress({ source: 'videos', page: pages })

    if (nextCursor === undefined || nextCursor === cursor)
      break
    cursor = nextCursor
    state.videosCursor = nextCursor
  }
}
