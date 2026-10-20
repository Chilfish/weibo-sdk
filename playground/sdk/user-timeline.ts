import type { SdkScenario } from '../lib/types'
import { argument, flagNumber } from '../lib/args'
import { defaultUid } from '../lib/defaults'
import { printTweet } from '../lib/format'

/** 用户资料 + 时间线单页 + 有界流式遍历。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'user-timeline',
  title: '用户资料与时间线',
  summary: 'users.getById + tweets.listByUserId + streamByUserId（手动 break 控制长度）',
  usage: 'pnpm play user-timeline [uid] [--count 10]',
  async run({ sdk, args, env, log }) {
    const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
    const count = flagNumber(args, 'count', 10)

    const user = await sdk.users.getById(uid)
    log.kv('user', `${user.name} (${user.id})`)
    log.kv('location', user.location)
    log.kv('followers', user.stats.followers)
    log.kv('statuses', user.stats.statuses)

    const page = await sdk.tweets.listByUserId(uid, { page: 1, count })
    log.kv('page', `page=${page.page ?? 1} hasMore=${page.hasMore} tweets=${page.tweets.length}`)
    for (const tweet of page.tweets.slice(0, 5))
      printTweet(tweet, log)

    log.heading('流式遍历（示例只取前 5 条）')
    let seen = 0
    for await (const tweet of sdk.tweets.streamByUserId(uid, { count })) {
      if (++seen > 5)
        break
      printTweet(tweet, log)
    }
    log.info('streamByUserId 默认会一直翻到空页；示例用计数提前 break，避免长时间跑。')
  },
}
