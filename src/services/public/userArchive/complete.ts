import type { TweetCommentsStreamOptions, TweetEnrichResult, TweetRepostsStreamOptions } from '~/services/public/TweetService'
import type { ArchivedTweet, ArchiveIssue } from '~/types/archive/IArchiveFile'
import type { UserArchiveContentOptions } from '~/types/archive/IUserArchive'
import type { ITweet, ITweetComment } from '~/types/domain/ITweet'
import { toUserArchiveIssue } from './issues'

export interface UserArchiveCompletionDeps {
  enrich: (mblogId: string) => Promise<TweetEnrichResult>
  streamComments: (mblogId: string, options?: TweetCommentsStreamOptions) => AsyncIterable<ITweetComment>
  streamReplies: (mblogId: string, rootCommentId: string, options?: TweetCommentsStreamOptions) => AsyncIterable<ITweetComment>
  streamReposts: (mblogId: string, options?: TweetRepostsStreamOptions) => AsyncIterable<ITweet>
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (item.id) {
      if (seen.has(item.id))
        continue
      seen.add(item.id)
    }
    out.push(item)
  }
  return out
}

const REPLY_CONCURRENCY = 4

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length)
        return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

/** 拉取一条微博的全部一级评论，并按需展开每条评论的楼中楼。 */
async function collectComments(
  deps: UserArchiveCompletionDeps,
  tweet: ITweet,
  options: UserArchiveContentOptions,
  issues: ArchiveIssue[],
): Promise<ITweetComment[]> {
  if (!options.includeComments)
    return []

  const flow: 0 | 1 = options.commentOrder === 'hot' ? 0 : 1
  const comments: ITweetComment[] = []
  try {
    for await (const comment of deps.streamComments(tweet.id, {
      flow,
      ...(options.maxComments === undefined ? {} : { maxItems: options.maxComments }),
      ...(options.maxCommentPages === undefined ? {} : { maxPages: options.maxCommentPages }),
    })) {
      comments.push(comment)
    }
  }
  catch (error) {
    issues.push(toUserArchiveIssue('comments', error, { mblogId: tweet.mblogId }))
  }

  if (!options.includeReplies)
    return comments

  // 楼中楼彼此独立，按小并发展开；单个评论的分页仍然串行。
  await mapWithConcurrency(comments, REPLY_CONCURRENCY, async (comment) => {
    const inline = comment.replies ?? []
    const expected = comment.totalReplies ?? 0
    // 没有楼中楼就不发请求；有内联预览但 total 缺失时也补拉一次。
    if (inline.length === 0 && expected <= 0)
      return

    const fetched: ITweetComment[] = []
    try {
      for await (const reply of deps.streamReplies(tweet.id, comment.id, {
        flow,
        ...(options.maxReplies === undefined ? {} : { maxItems: options.maxReplies }),
        ...(options.maxReplyPages === undefined ? {} : { maxPages: options.maxReplyPages }),
      })) {
        fetched.push(reply)
      }
    }
    catch (error) {
      issues.push(toUserArchiveIssue('replies', error, { mblogId: tweet.mblogId, commentId: comment.id }))
    }

    const merged = dedupeById([...inline, ...fetched])
    if (merged.length > 0)
      comment.replies = merged
  })

  return comments
}

/** 拉取一条微博的转发列表；与详情 / 评论互不依赖。 */
async function collectReposts(
  deps: UserArchiveCompletionDeps,
  tweet: ITweet,
  options: UserArchiveContentOptions,
  issues: ArchiveIssue[],
): Promise<ITweet[]> {
  const reposts: ITweet[] = []
  try {
    for await (const repost of deps.streamReposts(tweet.mblogId, {
      ...(options.maxReposts === undefined ? {} : { maxItems: options.maxReposts }),
      ...(options.maxRepostPages === undefined ? {} : { maxPages: options.maxRepostPages }),
    })) {
      reposts.push(repost)
    }
  }
  catch (error) {
    issues.push(toUserArchiveIssue('reposts', error, { mblogId: tweet.mblogId }))
  }
  return reposts
}

/** 补全单条微博：详情 + 长文 + 评论区（+ 可选转发列表），三个子请求并行。 */
export async function completeUserArchiveTweet(
  deps: UserArchiveCompletionDeps,
  base: ITweet,
  options: UserArchiveContentOptions,
): Promise<{ tweet: ArchivedTweet, issues: ArchiveIssue[] }> {
  const issues: ArchiveIssue[] = []
  const record: ArchivedTweet = {
    mblogId: base.mblogId,
    source: 'timeline',
    tweet: base,
    comments: [],
  }

  const detailTask = deps.enrich(base.mblogId)
    .then(detail => detail.tweet)
    .catch((error) => {
      issues.push(toUserArchiveIssue('detail', error, { mblogId: base.mblogId }))
      return undefined
    })
  const commentsTask = collectComments(deps, base, options, issues)
  const repostsTask = options.includeReposts
    ? collectReposts(deps, base, options, issues)
    : Promise.resolve(undefined)

  const [detail, comments, reposts] = await Promise.all([detailTask, commentsTask, repostsTask])
  if (detail)
    record.tweet = detail
  record.comments = comments
  if (reposts !== undefined)
    record.reposts = reposts

  return { tweet: record, issues }
}
