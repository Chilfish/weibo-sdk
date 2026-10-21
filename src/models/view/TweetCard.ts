import type { BuildTweetContextOptions } from './TweetContext'
import type { ITweet } from '~/types/domain/ITweet'
import { buildTweetContext, renderTweetContextMarkdown } from './TweetContext'

/**
 * 单条微博卡片：复用 `tweet context` 的投影与 Markdown 渲染，不额外发请求。
 *
 * `tweet detail` 直接调用；`tweet enrich` 可传入已补拉的长文。
 */
export function renderTweetCardMarkdown(
  tweet: ITweet,
  options: BuildTweetContextOptions = {},
): string {
  return renderTweetContextMarkdown(buildTweetContext(tweet, options))
}
