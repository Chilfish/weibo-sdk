import type { SdkScenario } from '../lib/types'
import { flagNumber, flagString } from '../lib/args'
import { printTweet } from '../lib/format'

/** 首页「最新微博」：max_id 翻旧页；since_id 只做增量过滤。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'home-feed',
  title: '首页关注时间线',
  summary: 'streamFriendTimeline（max_id 翻旧页）+ listFriendTimeline({ since_id }) 增量',
  usage: 'pnpm play home-feed [--max-pages 2] [--since-id <微博数字 id>]',
  async run({ sdk, args, log }) {
    const maxPages = flagNumber(args, 'max-pages', 1)
    const sinceId = flagString(args, 'since-id')

    if (sinceId) {
      const page = await sdk.tweets.listFriendTimeline({ since_id: sinceId })
      log.kv('incremental tweets', page.tweets.length)
      for (const tweet of page.tweets.slice(0, 10))
        printTweet(tweet, log)
      log.info('since_id 只返回比该微博更新的条目（单页），不是翻页游标。')
      return
    }

    let count = 0
    for await (const tweet of sdk.tweets.streamFriendTimeline({
      maxPages,
      onProgress: progress => log.progress(
        'home',
        progress.processed,
        progress.total,
      ),
    })) {
      if (++count <= 5)
        printTweet(tweet, log)
    }

    log.kv('tweets', count)
    log.kv('next page', '把本页返回的 maxId 传给 maxId / --max-id 可翻旧页')
    log.warn('total_number 实测恒为 2000 上限值，不能当作剩余条数。')
  },
}
