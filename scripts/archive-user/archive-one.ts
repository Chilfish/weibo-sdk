import type { ArchivedTweet, ArchiveIssue } from '../../src/types/archive/IArchiveFile'
import type { ITweet, ITweetComment } from '../../src/types/domain/ITweet'
import type { WeiboSDK } from '../../src/WeiboSDK'
import type { RunOptions } from './types'
import { toIssue } from './issues'

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

/** 拉取一条微博的全部一级评论，并按需展开每条评论的楼中楼。 */
async function collectComments(
  sdk: WeiboSDK,
  tweet: ITweet,
  options: RunOptions,
  issues: ArchiveIssue[],
): Promise<ITweetComment[]> {
  if (!options.includeComments)
    return []

  const flow: 0 | 1 = options.commentOrder === 'hot' ? 0 : 1
  const comments: ITweetComment[] = []
  try {
    for await (const comment of sdk.tweets.streamComments(tweet.id, {
      flow,
      ...(options.maxComments === undefined ? {} : { maxItems: options.maxComments }),
      ...(options.maxCommentPages === undefined ? {} : { maxPages: options.maxCommentPages }),
    })) {
      comments.push(comment)
    }
  }
  catch (error) {
    issues.push(toIssue('comments', error, { mblogId: tweet.mblogId }))
  }

  if (!options.includeReplies)
    return comments

  for (const comment of comments) {
    const inline = comment.replies ?? []
    const expected = comment.totalReplies ?? 0
    // 没有楼中楼就不发请求；有内联预览但 total 缺失时也补拉一次。
    if (inline.length === 0 && expected <= 0)
      continue

    const fetched: ITweetComment[] = []
    try {
      for await (const reply of sdk.tweets.streamReplies(tweet.id, comment.id, {
        flow,
        ...(options.maxReplies === undefined ? {} : { maxItems: options.maxReplies }),
        ...(options.maxReplyPages === undefined ? {} : { maxPages: options.maxReplyPages }),
      })) {
        fetched.push(reply)
      }
    }
    catch (error) {
      issues.push(toIssue('replies', error, { mblogId: tweet.mblogId, commentId: comment.id }))
    }

    const merged = dedupeById([...inline, ...fetched])
    if (merged.length > 0)
      comment.replies = merged
  }

  return comments
}

/** 补全单条微博：详情 + 长文 + 评论区（+ 可选转发列表）。 */
export async function archiveOne(
  sdk: WeiboSDK,
  base: ITweet,
  options: RunOptions,
): Promise<{ tweet: ArchivedTweet, issues: ArchiveIssue[] }> {
  const issues: ArchiveIssue[] = []
  const record: ArchivedTweet = {
    mblogId: base.mblogId,
    source: 'timeline',
    tweet: base,
    comments: [],
  }

  try {
    // statuses/show 默认带 isGetLongText=true，长微博全文已在 tweet.text。
    const detail = await sdk.tweets.enrich(base.mblogId)
    record.tweet = detail.tweet
  }
  catch (error) {
    issues.push(toIssue('detail', error, { mblogId: base.mblogId }))
  }

  record.comments = await collectComments(sdk, record.tweet, options, issues)

  if (options.includeReposts) {
    const reposts: ITweet[] = []
    try {
      for await (const repost of sdk.tweets.streamReposts(record.tweet.mblogId, {
        ...(options.maxReposts === undefined ? {} : { maxItems: options.maxReposts }),
        ...(options.maxRepostPages === undefined ? {} : { maxPages: options.maxRepostPages }),
      })) {
        reposts.push(repost)
      }
    }
    catch (error) {
      issues.push(toIssue('reposts', error, { mblogId: base.mblogId }))
    }
    record.reposts = reposts
  }

  return { tweet: record, issues }
}
