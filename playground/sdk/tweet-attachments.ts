import type { SdkScenario } from '../lib/types'
import { argument } from '../lib/args'
import { describeError } from '../lib/log'

/** 公开样本：文章 / 投票 / 直播 / 抽奖各一条；可传 mblogId 覆盖。 */
const SAMPLES = [
  { id: 'RnQe6zQ70', label: '文章' },
  { id: '5354652917040793', label: '投票' },
  { id: '5356760082679412', label: '直播' },
  { id: '5356487725023633', label: '抽奖' },
]

/** `ITweet.attachments` 与 `ITweetContext.post.attachments` 的实际读取方式。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'tweet-attachments',
  title: '特殊格式附件',
  summary: 'tweet.attachments / context.post.attachments：文章、投票、直播、抽奖',
  usage: 'pnpm play tweet-attachments [mblogId]',
  async run({ sdk, args, env, log }) {
    const explicit = argument(args, 0, 'PLAYGROUND_MBLOG_ID', env.values, '')
    const targets = explicit ? [{ id: explicit, label: '自定义' }] : SAMPLES

    for (const [index, target] of targets.entries()) {
      if (index > 0)
        log.info('')
      log.heading(`${target.label} · ${target.id}`)
      try {
        const tweet = await sdk.tweets.getByMblogId(target.id)
        log.kv('author', tweet.user.name)
        log.kv('pageInfo', tweet.pageInfo)
        log.kv('media', tweet.media.length)
        log.kv('attachments', tweet.attachments ?? [])

        const context = await sdk.tweets.context(target.id, { author: false, comments: 0 })
        log.kv('context.attachments', context.post.attachments)
        log.kv('context.unknowns', context.unknowns)
        log.kv('context.hints', context.hints)
      }
      catch (error) {
        log.error(`读取失败：${JSON.stringify(describeError(error))}`)
      }
    }
  },
}
