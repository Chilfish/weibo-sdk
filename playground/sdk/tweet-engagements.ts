import type { SdkScenario } from '../lib/types'
import { argument, flagNumber, flagString } from '../lib/args'
import { defaultMblogId, defaultUid } from '../lib/defaults'
import { describeError } from '../lib/log'

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 单条微博的「互动面」：分页版评论 / 楼中楼 / 转发 / 点赞者 / 长文 / 日期检索。
 *
 * 和 `tweet-comments` 的区别：这里用的是单页方法（`comments` / `replies` / `getReposts`），
 * 下游做「加载更多」按钮时通常用它们；流式方法适合批量归档。
 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'tweet-engagements',
  title: '微博互动面（单页 + 流式）',
  summary: 'comments / replies / getReposts / streamReposts / likers / longText / searchByDate',
  usage: 'pnpm play tweet-engagements [mblogId] [uid] [--since 2025-01-01] [--until 2025-01-31] [--max-pages 1]',
  async run({ sdk, args, env, log }) {
    const mblogId = argument(args, 0, 'PLAYGROUND_MBLOG_ID', env.values, defaultMblogId(env.values))
    const uid = argument(args, 1, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
    const maxPages = flagNumber(args, 'max-pages', 1)
    const since = flagString(args, 'since') ?? daysAgo(90)
    const until = flagString(args, 'until') ?? new Date().toISOString().slice(0, 10)

    const tweet = await sdk.tweets.getByMblogId(mblogId)
    log.kv('tweet', `${tweet.mblogId} · ${tweet.user.name} · ${tweet.createdAt}`)

    log.heading('一级评论（单页）')
    const commentsPage = await sdk.tweets.comments(mblogId, { flow: 1 })
    log.kv('comments', `count=${commentsPage.comments.length} cursor=${commentsPage.cursor} hasMore=${commentsPage.hasMore}`)
    if (commentsPage.notice)
      log.warn(`上游提示：${commentsPage.notice}`)

    const root = commentsPage.comments.find(comment => (comment.totalReplies ?? comment.replies?.length ?? 0) > 0)
    if (root) {
      log.heading(`楼中楼（单页）：${root.id}`)
      const repliesPage = await sdk.tweets.replies(mblogId, root.id)
      log.kv('replies', `count=${repliesPage.comments.length} cursor=${repliesPage.cursor} hasMore=${repliesPage.hasMore}`)
    }
    else {
      log.info('本页没有带回复的一级评论；换一条微博或加大样本。')
    }

    log.heading('转发（单页 + 流式）')
    const repostsPage = await sdk.tweets.getReposts(mblogId, { page: 1 })
    log.kv('getReposts', `count=${repostsPage.reposts.length} page=${repostsPage.page} hasMore=${repostsPage.hasMore}`)
    let streamed = 0
    for await (const repost of sdk.tweets.streamReposts(mblogId, { maxPages })) {
      if (++streamed <= 3)
        log.info(`- ${repost.mblogId} ${repost.user.name} · ${repost.text.slice(0, 60)}`)
    }
    log.kv('streamReposts', streamed)

    log.heading('点赞者（数字 mid）')
    try {
      const likersPage = await sdk.tweets.likers(tweet.id, { page: 1 })
      log.kv('likers', `count=${likersPage.likers.length} page=${likersPage.page} hasMore=${likersPage.hasMore}`)
      for (const liker of likersPage.likers.slice(0, 3))
        log.info(`- ${liker.id} ${liker.name}${liker.likedAt ? ` · ${liker.likedAt}` : ''}`)
    }
    catch (error) {
      log.warn(`likers 失败：${describeError(error).code ?? 'UNKNOWN'}（单节失败不影响后续）`)
    }

    log.heading('长文')
    try {
      const longText = await sdk.tweets.longText(mblogId)
      log.kv('longText', `${longText.text.length} chars markdown=${longText.isMarkdown ?? false}`)
    }
    catch (error) {
      log.warn(`longText 失败（普通微博可能没有长文）：${describeError(error).code ?? 'UNKNOWN'}`)
    }

    log.heading(`个人主页日期检索：${since} ~ ${until}`)
    try {
      const searchPage = await sdk.tweets.searchByDate(uid, {
        page: 1,
        starttime: since,
        endtime: until,
      })
      log.kv('searchByDate', `count=${searchPage.tweets.length} total=${searchPage.total ?? 'n/a'} hasMore=${searchPage.hasMore}`)
      for (const item of searchPage.tweets.slice(0, 3))
        log.info(`- ${item.mblogId} ${item.createdAt} ${item.text.slice(0, 60)}`)
    }
    catch (error) {
      log.warn(`searchByDate 失败：${describeError(error).code ?? 'UNKNOWN'}`)
    }
  },
}
