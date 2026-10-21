import type { IUser } from '~/types/domain/IUser'
import { Gender } from '~/types/domain/IUser'
import { formatCount } from './format'

const GENDER_LABEL: Record<string, string> = {
  [Gender.Male]: '男',
  [Gender.Female]: '女',
  [Gender.Unknown]: '未公开',
}

function markdownLink(title: string, url: string): string {
  if (!title)
    return `<${url}>`
  const text = title.replaceAll('[', '\\[').replaceAll(']', '\\]')
  return `[${text}](<${url}>)`
}

/**
 * 把 `IUser` 渲染成确定性的 Markdown 用户卡片（纯函数，不发请求）。
 *
 * 未公开的可选字段整行省略，不用空值占位；这是阅读视图，不是总结。
 */
export function renderUserMarkdown(user: IUser): string {
  const lines: string[] = [`# ${user.name || `uid ${user.id}`}`, '']

  lines.push(`- UID：${user.id}`)

  const verified = user.verification.isVerified
    ? user.verification.reason ? `已认证（${user.verification.reason}）` : '已认证'
    : '未认证'
  lines.push(`- 认证：${verified}`)

  const description = user.description?.trim()
  if (description) {
    const [first, ...rest] = description.split(/\r?\n/)
    lines.push(`- 简介：${first}`)
    for (const line of rest)
      lines.push(`  ${line}`)
  }

  const basics: string[] = []
  if (user.location)
    basics.push(`所在地：${user.location}`)
  basics.push(`性别：${GENDER_LABEL[user.gender] || '未公开'}`)
  if (user.birthday)
    basics.push(`生日：${user.birthday}`)
  lines.push(`- ${basics.join(' · ')}`)

  lines.push(`- 粉丝 ${formatCount(user.stats.followers)} · 关注 ${formatCount(user.stats.friends)} · 微博 ${formatCount(user.stats.statuses)}`)

  const membership: string[] = []
  if (user.svip)
    membership.push(`SVIP ${user.svip}`)
  if (user.mbrank)
    membership.push(`等级 ${user.mbrank}`)
  if (membership.length > 0)
    lines.push(`- 会员：${membership.join(' · ')}`)

  const identity: string[] = []
  if (user.realName)
    identity.push(`实名：${user.realName}`)
  if (user.company)
    identity.push(`公司：${user.company}`)
  if (user.school)
    identity.push(`学校：${user.school}`)
  if (user.hometown)
    identity.push(`家乡：${user.hometown}`)
  if (identity.length > 0)
    lines.push(`- ${identity.join(' · ')}`)

  const labels = user.labelDesc?.map(label => label.name).filter(name => name.length > 0) ?? []
  if (labels.length > 0)
    lines.push(`- 标签：${labels.join(' / ')}`)

  // 真实取值形如「阳光信用较好」；去掉前缀，避免渲染成「阳光信用：阳光信用较好」。
  const credit = user.creditLevel?.replace(/^阳光信用/, '').trim()
  if (credit && credit !== '0')
    lines.push(`- 阳光信用：${credit}`)

  if (user.createdAt)
    lines.push(`- 注册时间：${user.createdAt}`)
  if (user.url)
    lines.push(`- 主页：${user.url}`)

  for (const link of user.externalLinks ?? []) {
    if (link.url)
      lines.push(`- 链接：${markdownLink(link.title, link.url)}`)
  }

  return lines.join('\n')
}
