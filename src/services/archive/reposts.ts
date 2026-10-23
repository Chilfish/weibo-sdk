import type { RepostTimelineResponse } from '../endpoints/tweet'
import type { ArchiveItem } from '../public/ArchiveService'
import type { ArchiveRuntime } from './runtime'
import type { TimelineRawItem } from './utils'
import { Tweet } from '~/models/data/Tweet'
import { isRepeatedPage, uniqueByMblogId } from './utils'

/**
 * 内联某条微博的转发页（P1-2），转发本身不改变 timeline 游标语义。
 *
 * 第一页可由调用方预取（与父微博的评论链并行）；页内各条转发的评论
 * 也按 `concurrency` 窗口预取，产出顺序不变。
 */
export async function* streamReposts(
  runtime: ArchiveRuntime,
  parent: TimelineRawItem,
  prefetchedFirstPage?: Promise<RepostTimelineResponse | undefined>,
): AsyncIterableIterator<ArchiveItem> {
  const { uid, cp, maxPages, concurrency, options, progress } = runtime
  let repostPage = 1
  let repostPages = 0
  let previousRepostIds = new Set<string>()

  while (repostPages < maxPages) {
    const reposts = repostPage === 1 && prefetchedFirstPage !== undefined
      ? await prefetchedFirstPage
      : await runtime.fetchRepostPage(parent.mblogid, repostPage)
    if (!reposts)
      break // P1-4：转发页失败按策略 skip，继续下一条 timeline item
    const rawReposts = reposts.data || []
    const repostList = uniqueByMblogId(rawReposts)
    const repostIds = repostList.map(repost => repost.mblogid)
    if (repostIds.length === 0)
      break
    if (isRepeatedPage(repostIds, previousRepostIds))
      break

    for (let offset = 0; offset < repostList.length; offset += concurrency) {
      const chunk = repostList.slice(offset, offset + concurrency)
      const commentsList = chunk.map((repost) => {
        const comments = runtime.fetchItemComments(repost, 'repost', repostPage, parent.mblogid)
        void comments.catch(() => {})
        return comments
      })
      try {
        for (let index = 0; index < chunk.length; index++) {
          const repost = chunk[index]
          await options.onRaw?.(repost, {
            uid,
            source: 'repost',
            mblogId: repost.mblogid,
            page: repostPage,
            parentMblogId: parent.mblogid,
          })
          const tweet = new Tweet(repost)
          const comments = await commentsList[index]
          if (comments.length > 0)
            tweet.comments = comments
          progress.processed += 1
          yield runtime.buildItem(repost, 'repost', cp, tweet)
        }
      }
      finally {
        await Promise.allSettled(commentsList)
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
