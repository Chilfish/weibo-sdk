import type { SdkScenario } from '../lib/types'
import { argument, flagNumber } from '../lib/args'
import { defaultMblogId, defaultUid } from '../lib/defaults'

function displayName(user: { id: string, name: string }): string {
  return `${user.id || '?'} ${user.name}`.trim()
}

/** 关注 / 粉丝 / @我 / 分组 / 点赞者：社交关系面。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'social-graph',
  title: '关注、粉丝、@我与点赞者',
  summary: 'streamFollowings / streamFans / streamMentions / groups / streamLikers',
  usage: 'pnpm play social-graph [uid] [mblogId] [--max-pages 1]',
  async run({ sdk, args, env, log }) {
    const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
    const mblogId = argument(args, 1, 'PLAYGROUND_MBLOG_ID', env.values, defaultMblogId(env.values))
    const maxPages = flagNumber(args, 'max-pages', 1)

    log.heading(`关注列表（${uid}）`)
    let following = 0
    for await (const user of sdk.followings.streamFollowings(uid, { maxPages })) {
      if (++following <= 3)
        log.info(`- ${displayName(user)}`)
    }
    log.kv('following', following)

    log.heading(`粉丝列表（${uid}）`)
    let fans = 0
    for await (const user of sdk.followings.streamFans(uid, { maxPages })) {
      if (++fans <= 3)
        log.info(`- ${displayName(user)}`)
    }
    log.kv('fans', fans)

    log.heading('@我的微博')
    let mentions = 0
    for await (const tweet of sdk.users.streamMentions({ maxPages })) {
      if (++mentions <= 3)
        log.info(`- ${tweet.mblogId} ${tweet.user.name} · ${tweet.text.slice(0, 60)}`)
    }
    log.kv('mentions', mentions)

    log.heading('关注分组 / 微博分组')
    const groups = await sdk.users.groups()
    const mblogGroups = await sdk.users.mblogGroups()
    log.kv('groups', groups.length)
    for (const group of groups.slice(0, 5))
      log.info(`- ${group.id} ${group.title}${group.category ? ` (${group.category})` : ''}`)
    log.kv('mblogGroups', mblogGroups.length)
    for (const group of mblogGroups.slice(0, 5))
      log.info(`- ${group.id} ${group.name}`)

    log.heading('点赞者（入参必须是数字 mid）')
    const tweet = await sdk.tweets.getByMblogId(mblogId)
    let likers = 0
    for await (const liker of sdk.tweets.streamLikers(tweet.id, { maxPages })) {
      if (++likers <= 3)
        log.info(`- ${liker.id} ${liker.name}${liker.likedAt ? ` · ${liker.likedAt}` : ''}`)
    }
    log.kv('likers', likers)
    log.info('网页端 likeShow 恒为空，SDK 已改用 m.weibo.cn/api/attitudes/show。')
  },
}
