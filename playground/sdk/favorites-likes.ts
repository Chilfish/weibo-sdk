import type { SdkScenario } from '../lib/types'
import { argument, flagNumber, flagString } from '../lib/args'
import { defaultUid } from '../lib/defaults'
import { printComment, printTweet } from '../lib/format'

/** 收藏夹 / 点赞 / 我的历史评论：三个「个人数据面」流。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'favorites-likes',
  title: '收藏、点赞与历史评论',
  summary: 'streamFavorites（客户端标签过滤）+ streamByUserId + streamMine',
  usage: 'pnpm play favorites-likes [uid] [--tag 技术] [--max-pages 1]',
  async run({ sdk, args, env, log }) {
    const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
    const maxPages = flagNumber(args, 'max-pages', 1)
    const tag = flagString(args, 'tag')

    const tags = await sdk.favorites.getTags()
    log.kv('favorite tags', `tags=${tags.tags.length} total=${tags.total ?? 'n/a'}`)

    log.heading('单页接口')
    const favoritesPage = await sdk.favorites.listFavorites(uid, { page: 1 })
    log.kv('listFavorites', `tweets=${favoritesPage.tweets.length} totalPages=${favoritesPage.totalPages ?? 'n/a'} hasMore=${favoritesPage.hasMore}`)
    const likesPage = await sdk.likes.listByUserId(uid, { page: 1 })
    log.kv('likes.listByUserId', `tweets=${likesPage.tweets.length} hasMore=${likesPage.hasMore}`)
    const historyPage = await sdk.commentHistory.listMine()
    log.kv('commentHistory.listMine', `comments=${historyPage.comments.length} cursor=${historyPage.cursor} hasMore=${historyPage.hasMore}`)

    log.heading('收藏夹')
    let favorites = 0
    for await (const tweet of sdk.favorites.streamFavorites(uid, {
      maxPages,
      ...(tag ? { tag } : {}),
      onProgress: progress => log.progress('favorites', progress.processed, progress.total),
    })) {
      if (++favorites <= 3)
        printTweet(tweet, log)
    }
    log.kv('favorites', favorites)

    log.heading('我赞过的微博')
    let likes = 0
    for await (const tweet of sdk.likes.streamByUserId(uid, {
      maxPages,
      onProgress: progress => log.progress('likes', progress.processed),
    })) {
      if (++likes <= 3)
        printTweet(tweet, log)
    }
    log.kv('likes', likes)

    log.heading('我的历史评论')
    let comments = 0
    for await (const comment of sdk.commentHistory.streamMine({
      maxPages,
      onProgress: progress => log.progress('comments', progress.processed),
    })) {
      if (++comments <= 3)
        printComment(comment, log)
    }
    log.kv('comments', comments)
    log.info('历史评论只读取当前登录用户自己的评论（身份由 Cookie 决定）。')
  },
}
