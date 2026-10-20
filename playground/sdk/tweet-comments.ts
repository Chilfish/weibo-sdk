import type { ITweet, ITweetComment } from '@chilfish/weibo-sdk'
import type { SdkScenario } from '../lib/types'
import { argument, flagNumber } from '../lib/args'
import { defaultMblogId } from '../lib/defaults'
import { printComment, printTweet } from '../lib/format'

/** 单条微博 + 评论流 + 图片评论 + 楼中楼。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'tweet-comments',
  title: '微博详情与评论',
  summary: 'getByMblogId + streamComments（max_id）+ 图片评论 pics + streamReplies 楼中楼',
  usage: 'pnpm play tweet-comments [mblogId] [--max-pages 1] [--flow 0|1]',
  async run({ sdk, args, env, log }) {
    const mblogId = argument(args, 0, 'PLAYGROUND_MBLOG_ID', env.values, defaultMblogId(env.values))
    const maxPages = flagNumber(args, 'max-pages', 1)
    const flowRaw = flagNumber(args, 'flow', 0)
    const flow = flowRaw === 1 ? 1 : 0

    const tweet: ITweet = await sdk.tweets.getByMblogId(mblogId)
    printTweet(tweet, log)
    log.kv('topics', tweet.topics?.join(' / '))
    log.kv('repostChain', tweet.repostChain?.length ?? 0)
    log.kv('media', tweet.media.length)

    const comments: ITweetComment[] = []
    log.heading('评论流')
    for await (const comment of sdk.tweets.streamComments(mblogId, {
      maxPages,
      flow,
      onProgress: progress => log.progress('comments', progress.processed, progress.total),
    })) {
      comments.push(comment)
      if (comments.length <= 5)
        printComment(comment, log)
    }
    log.kv('comments', comments.length)

    const withPics = comments.find(comment => (comment.pics?.length ?? 0) > 0)
    if (withPics?.pics) {
      log.heading('图片评论')
      log.info(`评论 ${withPics.id} 有 ${withPics.pics.length} 张图（URL 是临时签名，需及时下载）`)
      for (const pic of withPics.pics)
        log.info(`- ${pic.id} ${pic.width}x${pic.height} ${pic.imageUrl}`)
    }

    const withReplies = comments.find(comment => (comment.totalReplies ?? comment.replies?.length ?? 0) > 0)
    if (withReplies) {
      log.heading(`楼中楼：${withReplies.id}`)
      let replies = 0
      for await (const reply of sdk.tweets.streamReplies(mblogId, withReplies.id, { maxPages: 1 })) {
        if (++replies <= 5)
          printComment(reply, log)
      }
      log.kv('replies', replies)
    }
    else {
      log.info('本页没有带回复的一级评论；可换一条微博或加大 --max-pages。')
    }
  },
}
