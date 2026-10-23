import type { SdkScenario } from '../lib/types'
import { flagNumber } from '../lib/args'
import { excerpt } from '../lib/log'

/** 消息通知：评论通知 / 点赞通知（max_id 游标）。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'notifications',
  title: '评论与点赞通知',
  summary: 'streamComments / streamLikes（max_id + next_cursor=0 停止）',
  usage: 'pnpm play notifications [--max-pages 1]',
  async run({ sdk, args, log }) {
    const maxPages = flagNumber(args, 'max-pages', 1)

    log.heading('单页接口')
    const commentPage = await sdk.notifications.listComments({ page: 1 })
    log.kv('listComments', `items=${commentPage.items.length} cursor=${commentPage.cursor} hasMore=${commentPage.hasMore}`)
    const likePage = await sdk.notifications.listLikes({ page: 1 })
    log.kv('listLikes', `items=${likePage.items.length} cursor=${likePage.cursor} hasMore=${likePage.hasMore}`)

    log.heading('评论通知')
    let comments = 0
    for await (const item of sdk.notifications.streamComments({
      maxPages,
      onProgress: progress => log.progress('notifications', progress.processed),
    })) {
      if (++comments <= 5) {
        log.info(`- ${item.comment.user.name} 评论了 ${item.tweet.mblogId}`)
        log.info(`  ${excerpt(item.comment.text, 80)}`)
      }
    }
    log.kv('comments', comments)

    log.heading('点赞通知')
    let likes = 0
    for await (const item of sdk.notifications.streamLikes({
      maxPages,
      onProgress: progress => log.progress('notifications', progress.processed),
    })) {
      if (++likes <= 5)
        log.info(`- ${item.user.name} 赞了 ${item.tweet.mblogId}${item.createdAt ? ` · ${item.createdAt}` : ''}`)
    }
    log.kv('likes', likes)
    log.info('原微博已删除的条目会被 SDK 跳过（上游不返回 status）。')
  },
}
