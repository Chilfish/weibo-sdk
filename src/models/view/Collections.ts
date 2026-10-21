import type { MarkdownListOptions } from './format'
import type { MblogGroup, UserGroup } from '~/types/domain/IGroup'
import type { SuperTopic, SuperTopicCategory } from '~/types/domain/ISuperTopic'
import type { IUserAlbum } from '~/types/domain/IUserMediaAsset'
import { formatCount, renderListHeader, summarizeText } from './format'

/** 热搜榜条目（`data.realtime[]` 的渲染子集）。 */
export interface TrendItemLike {
  word: string
  num?: number
  category?: string
  label_name?: string
  icon_desc?: string
}

/** 关注分组（`user groups`）。 */
export function renderUserGroupListMarkdown(
  groups: readonly UserGroup[],
  options: Partial<MarkdownListOptions> = {},
): string {
  const lines = renderListHeader({ title: options.title ?? '关注分组', notes: options.notes })
  if (groups.length === 0) {
    lines.push(options.emptyText ?? '（没有关注分组）')
    return lines.join('\n')
  }

  groups.forEach((group, index) => {
    const meta = [`id ${group.id}`]
    if (group.category)
      meta.push(`分类：${group.category}`)
    if (group.count !== undefined)
      meta.push(`微博 ${formatCount(group.count)}`)
    if (group.type)
      meta.push(`type ${group.type}`)
    lines.push(`${index + 1}. **${group.title || group.id}** · ${meta.join(' · ')}`)
  })
  return lines.join('\n').trimEnd()
}

/** 微博分组（`user mblog-groups`）。 */
export function renderMblogGroupListMarkdown(
  groups: readonly MblogGroup[],
  options: Partial<MarkdownListOptions> = {},
): string {
  const lines = renderListHeader({ title: options.title ?? '微博分组', notes: options.notes })
  if (groups.length === 0) {
    lines.push(options.emptyText ?? '（没有微博分组）')
    return lines.join('\n')
  }

  groups.forEach((group, index) => {
    const meta = [`id ${group.id}`]
    if (group.systemName && group.systemName !== group.name)
      meta.push(`系统名：${group.systemName}`)
    if (group.pageObjectId)
      meta.push(`pageObjectId：${group.pageObjectId}`)
    lines.push(`${index + 1}. **${group.name || group.id}** · ${meta.join(' · ')}`)
  })
  return lines.join('\n').trimEnd()
}

/** 超话分类（`topic cates`）。 */
export function renderSuperTopicCategoryListMarkdown(
  categories: readonly SuperTopicCategory[],
  options: Partial<MarkdownListOptions> = {},
): string {
  const lines = renderListHeader({ title: options.title ?? '超话分类', notes: options.notes })
  if (categories.length === 0) {
    lines.push(options.emptyText ?? '（没有超话分类）')
    return lines.join('\n')
  }

  categories.forEach((category, index) => {
    lines.push(`${index + 1}. **${category.name}** · id ${category.id}`)
  })
  return lines.join('\n').trimEnd()
}

/** 超话列表 / 关键词搜索结果（`topic list`）。 */
export function renderSuperTopicListMarkdown(
  topics: readonly SuperTopic[],
  options: Partial<MarkdownListOptions> = {},
): string {
  const lines = renderListHeader({ title: options.title ?? '超话列表', notes: options.notes })
  if (topics.length === 0) {
    lines.push(options.emptyText ?? '（本页没有超话）')
    return lines.join('\n')
  }

  const maxChars = options.maxChars ?? 160
  topics.forEach((topic, index) => {
    const meta = [topic.pageId]
    if (topic.isCircle)
      meta.push('圈子')
    lines.push(`${index + 1}. **${topic.title}** · ${meta.join(' · ')}`)
    if (topic.description)
      lines.push(`   ${summarizeText(topic.description, maxChars)}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

/** 相册列表（`media albums`）。 */
export function renderAlbumListMarkdown(
  albums: readonly IUserAlbum[],
  options: Partial<MarkdownListOptions> = {},
): string {
  const lines = renderListHeader({ title: options.title ?? '相册', notes: options.notes })
  if (albums.length === 0) {
    lines.push(options.emptyText ?? '（没有相册）')
    return lines.join('\n')
  }

  albums.forEach((album, index) => {
    lines.push(`${index + 1}. **${album.title}** · containerId ${album.containerId}`)
  })
  return lines.join('\n').trimEnd()
}

/** 热搜榜（`trends`）。 */
export function renderTrendListMarkdown(
  items: readonly TrendItemLike[],
  options: Partial<MarkdownListOptions> = {},
): string {
  const lines = renderListHeader({ title: options.title ?? '热搜榜', notes: options.notes })
  if (items.length === 0) {
    lines.push(options.emptyText ?? '（榜单为空）')
    return lines.join('\n')
  }

  items.forEach((item, index) => {
    const meta: string[] = []
    if (item.num !== undefined)
      meta.push(`热度 ${formatCount(item.num)}`)
    if (item.category)
      meta.push(item.category)
    const label = item.label_name || item.icon_desc
    if (label)
      meta.push(label)
    lines.push(`${index + 1}. ${item.word}${meta.length > 0 ? ` · ${meta.join(' · ')}` : ''}`)
  })
  return lines.join('\n').trimEnd()
}
