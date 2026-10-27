import type { MarkdownListOptions } from './format'
import type { TweetLiker } from '~/types/domain/ILiker'
import type { CommentNotification, LikeNotification } from '~/types/domain/INotification'
import type { ITweet, ITweetComment } from '~/types/domain/ITweet'
import { formatCount, formatWhen, renderListHeader, summarizeText } from './format'

/** 列表里的正文摘要长度；完整正文请用 `--format json`。 */
export const TWEET_LIST_EXCERPT = 200

/** 微博网页永久链接（缺 `sourceUrl` 时按 uid + mblogId 拼）。 */
export function tweetPermalink(tweet: ITweet): string {
  return tweet.sourceUrl || `https://weibo.com/${tweet.user.id}/${tweet.mblogId}`
}

function authorLabel(user: { id: string, name: string, verified: boolean }): string {
  return `**@${user.name || user.id}**${user.verified ? '（已认证）' : ''}`
}

function tweetTitle(tweet: ITweet): string {
  const badges: string[] = []
  if (tweet.flags?.pinned)
    badges.push('置顶')
  if (tweet.retweetedStatus || (tweet.repostChain?.length ?? 0) > 0)
    badges.push('转发')
  return [authorLabel(tweet.user), formatWhen(tweet.createdAt), ...badges].join(' · ')
}

function tweetCounters(tweet: ITweet): string {
  const parts = [
    `赞 ${formatCount(tweet.stats.likes)}`,
    `评论 ${formatCount(tweet.stats.comments)}`,
    `转发 ${formatCount(tweet.stats.reposts)}`,
  ]
  if (tweet.media.length > 0)
    parts.push(`媒体 ${tweet.media.length}`)
  if (tweet.stats.reads !== undefined)
    parts.push(`阅读 ${formatCount(tweet.stats.reads)}`)
  return parts.join(' · ')
}

/**
 * 列表摘要。
 *
 * 转发微博的 `text` 常常只是占位符「转发微博」，`repostChain[0]` 才是当前作者的话；
 * 当前作者没说话时退回原微博正文，并显式标注归属，避免把原文当成转发者的观点。
 */
function tweetExcerpt(tweet: ITweet, maxChars: number): string {
  const own = summarizeText(tweet.repostChain?.[0]?.text ?? tweet.text, maxChars)
  if (own && own !== '转发微博')
    return own

  const quoted = tweet.retweetedStatus
  if (!quoted)
    return own

  const author = quoted.user.name || quoted.user.id
  return `转发 @${author}：${summarizeText(quoted.text, maxChars)}`
}

/** 单条微博在列表里的四行表示（标题 / 摘要 / 计数 / 链接）。 */
export function renderTweetListItemMarkdown(
  tweet: ITweet,
  index: number,
  maxChars = TWEET_LIST_EXCERPT,
): string[] {
  const text = tweetExcerpt(tweet, maxChars)
  return [
    `${index}. ${tweetTitle(tweet)}`,
    `   ${text || '（无正文）'}`,
    `   ${tweetCounters(tweet)}`,
    `   ${tweetPermalink(tweet)}`,
  ]
}

/** 微博列表（时间线 / 首页 / 点赞 / 收藏 / 转发 / 搜索结果共用）。 */
export function renderTweetListMarkdown(
  tweets: readonly ITweet[],
  options: MarkdownListOptions,
): string {
  const lines = renderListHeader(options)
  if (tweets.length === 0) {
    lines.push(options.emptyText ?? '（本页没有微博）')
    return lines.join('\n')
  }

  const maxChars = options.maxChars ?? TWEET_LIST_EXCERPT
  tweets.forEach((tweet, index) => {
    lines.push(...renderTweetListItemMarkdown(tweet, index + 1, maxChars))
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

/** 评论列表（`tweet comments` / `tweet replies` / `comment mine` 共用）。 */
export function renderCommentListMarkdown(
  comments: readonly ITweetComment[],
  options: MarkdownListOptions,
): string {
  const lines = renderListHeader(options)
  if (comments.length === 0) {
    lines.push(options.emptyText ?? '（本页没有评论）')
    return lines.join('\n')
  }

  const maxChars = options.maxChars ?? TWEET_LIST_EXCERPT
  comments.forEach((comment, index) => {
    const meta = [`赞 ${formatCount(comment.likes)}`]
    if (comment.totalReplies !== undefined)
      meta.push(`回复 ${formatCount(comment.totalReplies)}`)
    if (comment.pics && comment.pics.length > 0)
      meta.push(`图片 ${comment.pics.length}`)
    lines.push(`${index + 1}. ${authorLabel(comment.user)} · ${formatWhen(comment.createdAt)}`)
    lines.push(`   ${summarizeText(comment.text, maxChars) || '（无正文）'}`)
    lines.push(`   ${meta.join(' · ')}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

/** 点赞者列表。 */
export function renderLikerListMarkdown(
  likers: readonly TweetLiker[],
  options: MarkdownListOptions,
): string {
  const lines = renderListHeader(options)
  if (likers.length === 0) {
    lines.push(options.emptyText ?? '（还没有点赞者）')
    return lines.join('\n')
  }

  likers.forEach((liker, index) => {
    const meta: string[] = []
    if (liker.likedAt)
      meta.push(formatWhen(liker.likedAt))
    if (liker.source)
      meta.push(liker.source)
    lines.push(`${index + 1}. ${authorLabel(liker)}${meta.length > 0 ? ` · ${meta.join(' · ')}` : ''}`)
  })
  return lines.join('\n').trimEnd()
}

/** 评论通知列表。 */
export function renderCommentNotificationListMarkdown(
  items: readonly CommentNotification[],
  options: MarkdownListOptions,
): string {
  const lines = renderListHeader(options)
  if (items.length === 0) {
    lines.push(options.emptyText ?? '（没有评论通知）')
    return lines.join('\n')
  }

  const maxChars = options.maxChars ?? TWEET_LIST_EXCERPT
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${authorLabel(item.comment.user)} 评论了你的微博 · ${formatWhen(item.comment.createdAt)}`)
    lines.push(`   评论：${summarizeText(item.comment.text, maxChars) || '（无正文）'}`)
    lines.push(`   原微博：${authorLabel(item.tweet.user)} · ${summarizeText(item.tweet.text, 80) || '（无正文）'}`)
    lines.push(`   ${tweetPermalink(item.tweet)}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

/** 点赞通知列表。 */
export function renderLikeNotificationListMarkdown(
  items: readonly LikeNotification[],
  options: MarkdownListOptions,
): string {
  const lines = renderListHeader(options)
  if (items.length === 0) {
    lines.push(options.emptyText ?? '（没有点赞通知）')
    return lines.join('\n')
  }

  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${authorLabel(item.user)} 赞了你的微博 · ${formatWhen(item.createdAt)}`)
    lines.push(`   原微博：${authorLabel(item.tweet.user)} · ${summarizeText(item.tweet.text, 80) || '（无正文）'}`)
    lines.push(`   ${tweetPermalink(item.tweet)}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}
