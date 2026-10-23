import type { MarkdownListOptions } from './format'
import type { UserBrief } from '~/types/domain/IUser'
import { formatCount, renderListHeader, summarizeText } from './format'

function relationLabel(user: UserBrief): string | undefined {
  if (user.following && user.followedBy)
    return '互相关注'
  if (user.following)
    return '已关注'
  if (user.followedBy)
    return '关注了你'
  return undefined
}

/** 关注 / 粉丝 / 我的关注列表。 */
export function renderFollowingUserListMarkdown(
  users: readonly UserBrief[],
  options: MarkdownListOptions,
): string {
  const lines = renderListHeader(options)
  if (users.length === 0) {
    lines.push(options.emptyText ?? '（本页没有用户）')
    return lines.join('\n')
  }

  const maxChars = options.maxChars ?? 120
  users.forEach((user, index) => {
    const meta: string[] = []
    if (user.stats.followers > 0)
      meta.push(`粉丝 ${formatCount(user.stats.followers)}`)
    if (user.location)
      meta.push(user.location)
    const relation = relationLabel(user)
    if (relation)
      meta.push(relation)
    lines.push(`${index + 1}. **@${user.name || user.id}**${user.verified ? `（已认证${user.verifiedReason ? `：${user.verifiedReason}` : ''}）` : ''}${meta.length > 0 ? ` · ${meta.join(' · ')}` : ''}`)
    if (user.description)
      lines.push(`   ${summarizeText(user.description, maxChars)}`)
    lines.push(`   uid ${user.id} · ${user.url || `https://weibo.com/u/${user.id}`}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}
