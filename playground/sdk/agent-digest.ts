import type { ITweet, ITweetContext } from '@chilfish/weibo-sdk'
import type { SdkScenario } from '../lib/types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { flagNumber, flagString } from '../lib/args'
import { excerpt } from '../lib/log'

function renderContext(context: ITweetContext): string {
  const lines = [
    `### ${context.post.author.name} · ${context.post.publishedAt}`,
    '',
    context.post.text,
    '',
  ]

  if (context.post.topics.length > 0)
    lines.push(`话题：${context.post.topics.map(topic => `#${topic}#`).join(' ')}`)
  if (context.post.mentions.length > 0)
    lines.push(`提及：${context.post.mentions.map(name => `@${name}`).join(' ')}`)
  if (context.media.length > 0) {
    const media = context.media
      .map(item => `${item.type}${item.owner.relation === 'quoted' ? '(原微博)' : ''}`)
      .join(', ')
    lines.push(`媒体：${media}`)
  }
  if (context.post.attachments.length > 0)
    lines.push(`附件：${context.post.attachments.map(item => `${item.kind}:${item.title}`).join(', ')}`)
  if (context.quoted)
    lines.push(`转发自：${context.quoted.post.author.name} — ${excerpt(context.quoted.post.text, 120)}`)
  if (context.discussion && context.discussion.length > 0)
    lines.push(`评论样本：${context.discussion.length} 条`)
  if (context.unknowns.length > 0)
    lines.push(`未知项：${context.unknowns.join(' / ')}`)
  if (context.hints.length > 0)
    lines.push(`提示：${context.hints.join(' / ')}`)

  lines.push('', `[原文](${context.post.url ?? `https://m.weibo.cn/status/${context.post.mblogId}`})`)
  return lines.join('\n')
}

/**
 * Agent / 下游的典型管线：拉一页 Feed → 逐条取 context → 生成 Markdown 摘要。
 *
 * `context` 是确定性投影：`post.text` 只含当前作者发言，转发链不会拍平；
 * 无法确定的信息会出现在 `unknowns`，不会伪造默认值。
 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'agent-digest',
  title: 'Feed → context → Markdown 摘要',
  summary: 'listFriendTimeline / listByUserId → tweets.context → 本地 Markdown 卡片',
  usage: 'pnpm play agent-digest [--uid 1111681197] [--max-items 3] [--comments 2]',
  async run({ sdk, args, paths, log }) {
    const uid = flagString(args, 'uid')
    const limit = flagNumber(args, 'max-items', 3)
    const comments = flagNumber(args, 'comments', 2)

    const page = uid
      ? await sdk.tweets.listByUserId(uid, { page: 1, count: limit })
      : await sdk.tweets.listFriendTimeline()

    const tweets: ITweet[] = page.tweets.slice(0, limit)
    log.kv('source', uid ? `user timeline ${uid}` : 'friend timeline')
    log.kv('tweets', tweets.length)

    const sections: string[] = [
      `# 微博摘要 ${new Date().toISOString().slice(0, 10)}`,
      '',
      `来源：${uid ? `用户 ${uid}` : '关注时间线'} · 共 ${tweets.length} 条`,
    ]

    for (const tweet of tweets) {
      log.info(`- ${tweet.mblogId} ${tweet.user.name} · ${excerpt(tweet.text, 70)}`)
      const context = await sdk.tweets.context(tweet.mblogId, { comments })
      log.info(`  context: media=${context.media.length} quoted=${context.quoted ? 'yes' : 'no'} unknowns=${context.unknowns.length}`)
      sections.push('', renderContext(context))
    }

    const dir = join(paths.output, 'digest')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${new Date().toISOString().slice(0, 10)}.md`)
    writeFileSync(file, `${sections.join('\n')}\n`, 'utf8')

    log.kv('file', file)
    log.info('context 的 media URL 是临时签名地址；要保留请及时下载。')
    log.info('`unknowns` 列出图片未描述、视频未转写、评论为抽样等缺口，Agent 不应忽略它们。')
  },
}
