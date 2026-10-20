import type { ITweet, ITweetComment, IUserMediaAsset } from '@chilfish/weibo-sdk'
import type { PlaygroundLog } from './types'
import { excerpt } from './log'

/** 统一的单条微博摘要（避免每个场景各写一份）。 */
export function printTweet(tweet: ITweet, log: PlaygroundLog): void {
  const media = tweet.media.length > 0
    ? ` media=${tweet.media.map(item => item.type).join('/')}`
    : ''
  log.info(`- ${tweet.mblogId} · ${tweet.createdAt} · ${tweet.user.name}${media}`)
  log.info(`  ${excerpt(tweet.text, 110)}`)
  if (tweet.sourceUrl)
    log.info(`  ${tweet.sourceUrl}`)
}

/** 评论摘要：带图片 / 楼中楼数量。 */
export function printComment(comment: ITweetComment, log: PlaygroundLog): void {
  const pics = comment.pics?.length ? ` pics=${comment.pics.length}` : ''
  const replies = comment.totalReplies !== undefined ? ` replies=${comment.totalReplies}` : ''
  log.info(`- ${comment.id} · ${comment.user.name}${pics}${replies} · ${excerpt(comment.text, 80)}`)
}

/** 媒体资产摘要：类型 / 时长 / 临时 URL。 */
export function printAsset(asset: IUserMediaAsset, log: PlaygroundLog): void {
  const duration = asset.duration === undefined ? '' : ` ${asset.duration}s`
  log.info(`- ${asset.type} ${asset.id}${duration} · ${excerpt(asset.url, 100)}`)
}
