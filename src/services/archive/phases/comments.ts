import type { ArchiveItem } from '../../public/ArchiveService'
import type { ArchiveRuntime } from '../runtime'
import type { TimelineRawItem } from '../utils'
import { normalizeComment, Tweet } from '~/models/data/Tweet'
import { parseCursor, parseTotal } from '../utils'

/** comments 阶段：当前登录用户历史评论（max_id 游标，评论本体挂到 `item.comment`）。 */
export async function* streamCommentHistory(runtime: ArchiveRuntime): AsyncGenerator<ArchiveItem, void, undefined> {
  const commentHistoryDep = runtime.commentHistory
  if (!commentHistoryDep)
    return

  const { cp, uid, options, maxPages, state } = runtime
  let cursor = state.commentHistoryCursor
  let pages = 0
  const seen = new Set<string>()

  while (pages < maxPages) {
    const requestOptions = cursor !== undefined ? { maxId: cursor } : {}
    const raw = await runtime.runWithPolicy(
      () => commentHistoryDep(requestOptions),
      { stage: 'commentHistory', source: 'comment', page: pages + 1 },
      runtime.commentHistoryErrorPolicy,
    )
    if (!raw)
      break
    const rawComments = raw.data.comments || []
    if (rawComments.length === 0)
      break // 空页 = 到底
    const nextCursor = parseCursor(raw.data.next_cursor)

    let fresh = 0
    for (const rawComment of rawComments) {
      const status = (rawComment as { status?: TimelineRawItem }).status
      if (!status || typeof status.mblogid !== 'string')
        continue

      const commentId = String(rawComment.idstr || rawComment.id || '')
      if (commentId) {
        if (seen.has(commentId))
          continue
        seen.add(commentId)
      }

      await options.onRaw?.(rawComment, {
        uid,
        source: 'comment',
        mblogId: status.mblogid,
        page: pages + 1,
      })

      cp.phase = 'comments'
      cp.page = undefined
      cp.lastTimelineMblogId = undefined
      cp.favoritesPage = undefined
      delete cp.likesPage
      if (cursor !== undefined)
        cp.commentHistoryCursor = cursor
      else
        delete cp.commentHistoryCursor
      delete cp.sliceEnd
      delete cp.slicePage
      delete cp.sliceWindow

      const tweet = new Tweet(status)
      const item = runtime.buildItem(status, 'comment', cp, tweet)
      item.comment = normalizeComment(rawComment)
      runtime.progress.processed += 1
      fresh += 1
      yield item
    }

    pages += 1
    if (fresh === 0)
      break // 整页都是无效 / 重复项
    const total = parseTotal(raw.data.total_number)
    await runtime.reportProgress({
      source: 'comments',
      total,
      remaining: total !== undefined ? Math.max(0, total - runtime.progress.processed) : undefined,
      page: pages,
    })

    if (nextCursor === 0)
      break // 到底
    if (cursor !== undefined && nextCursor === cursor)
      break // 游标不前进
    cursor = nextCursor
    state.commentHistoryCursor = cursor
  }
}
