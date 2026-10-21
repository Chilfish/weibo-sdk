import type { MarkdownListOptions } from './format'
import { formatCount, renderListHeader, summarizeText } from './format'

/**
 * 关注 / 粉丝列表里的用户（`FriendshipsResponse` / `FollowContentResponse` 的 `users[]`）。
 *
 * 这些端点返回 raw 用户对象；这里只读取渲染需要的稳定字段，缺失时整段省略。
 */
export interface FollowingUserLike {
  id?: string | number
  idstr?: string
  screen_name?: string
  name?: string
  description?: string
  location?: string
  followers_count?: number
  verified?: boolean
  verified_reason?: string
  following?: boolean
  follow_me?: boolean
}

function userId(user: FollowingUserLike): string {
  return String(user.idstr ?? user.id ?? '')
}

function displayName(user: FollowingUserLike): string {
  return user.screen_name || user.name || userId(user)
}

function relationLabel(user: FollowingUserLike): string | undefined {
  if (user.following && user.follow_me)
    return '互相关注'
  if (user.following)
    return '已关注'
  if (user.follow_me)
    return '关注了你'
  return undefined
}

/** 关注 / 粉丝 / 我的关注列表。 */
export function renderFollowingUserListMarkdown(
  users: readonly FollowingUserLike[],
  options: MarkdownListOptions,
): string {
  const lines = renderListHeader(options)
  if (users.length === 0) {
    lines.push(options.emptyText ?? '（本页没有用户）')
    return lines.join('\n')
  }

  const maxChars = options.maxChars ?? 120
  users.forEach((user, index) => {
    const id = userId(user)
    const meta: string[] = []
    if (user.followers_count !== undefined)
      meta.push(`粉丝 ${formatCount(user.followers_count)}`)
    if (user.location)
      meta.push(user.location)
    const relation = relationLabel(user)
    if (relation)
      meta.push(relation)
    lines.push(`${index + 1}. **@${displayName(user)}**${user.verified ? `（已认证${user.verified_reason ? `：${user.verified_reason}` : ''}）` : ''}${meta.length > 0 ? ` · ${meta.join(' · ')}` : ''}`)
    if (user.description)
      lines.push(`   ${summarizeText(user.description, maxChars)}`)
    lines.push(`   uid ${id} · https://weibo.com/u/${id}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}
