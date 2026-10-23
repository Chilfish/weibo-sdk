import type { BuildCommentsResponse } from '../../endpoints/tweet'
import type { TweetCommentsStreamOptions, TweetCommentsStreamProgress } from './types'
import type { ITweetComment } from '~/types/domain/ITweet'
import { normalizeComment } from '~/models/data/Tweet'
import { normalizeMaxPages } from '~/utils/pagination'
import { createStreamRange } from '~/utils/streamRange'

/**
 * 评论 / 楼中楼共用的分页循环。
 *
 * `max_id` 游标 + 按评论 id 去重；停止条件：空页、整页重复、游标缺失 / 为 0 / 不前进、`maxPages`。
 * 不能用 `total_number` 判断结束（顶层评论的 total 包含楼中楼 / 不可见评论）。
 */
export async function* streamCommentPagesFrom(
  mblogId: string,
  options: TweetCommentsStreamOptions,
  fetchPage: (cursor?: number) => Promise<BuildCommentsResponse>,
): AsyncIterableIterator<ITweetComment> {
  const maxPages = normalizeMaxPages(options.maxPages)
  const range = createStreamRange<ITweetComment>(options)
  const seen = new Set<string>()
  let cursor = options.maxId
  let page = 1
  let pages = 0
  let processed = 0

  while (pages < maxPages) {
    const raw = await fetchPage(cursor)
    pages += 1

    const items = raw.data ?? []
    if (items.length === 0)
      break

    const fresh: ITweetComment[] = []
    for (const item of items) {
      const comment = normalizeComment(item)
      if (comment.id) {
        if (seen.has(comment.id))
          continue
        seen.add(comment.id)
      }
      fresh.push(comment)
    }
    if (fresh.length === 0)
      break

    for (const comment of fresh) {
      const decision = range.decide(comment)
      if (decision === 'stop')
        break
      if (decision === 'skip')
        continue
      processed += 1
      yield comment
    }

    const progress: TweetCommentsStreamProgress = {
      mblogId,
      page,
      processed,
      pageSize: items.length,
      total: raw.total_number,
    }
    try {
      await options.onProgress?.(progress)
    }
    catch {
      // 进度回调异常不影响流
    }

    if (range.stopped)
      break

    const next = typeof raw.max_id === 'number' && raw.max_id > 0 ? raw.max_id : undefined
    if (next === undefined || next === cursor)
      break
    cursor = next
    page += 1
  }
}
