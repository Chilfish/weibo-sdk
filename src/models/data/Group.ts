import type { FeedGroupsResponse, MblogGroupsResponse } from '~/services/endpoints/groups'
import type { MblogGroup, UserGroup } from '~/types/domain/IGroup'

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0)
      return value
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value)
  }
  return undefined
}

/**
 * 拍平 `/ajax/feed/allGroups` 的分类结构（`groups[].group[]`），按 `gid` 去重。
 *
 * 纯函数；缺失 `gid` 的条目会跳过（无法作为稳定标识）。
 */
export function normalizeUserGroups(raw: FeedGroupsResponse): UserGroup[] {
  const out: UserGroup[] = []
  const seen = new Set<string>()

  for (const category of raw.groups) {
    for (const group of category.group) {
      const id = firstString(group.gid)
      if (id === undefined || seen.has(id))
        continue
      seen.add(id)

      const item: UserGroup = {
        id,
        title: group.title ?? '',
      }
      if (category.title !== undefined)
        item.category = category.title
      if (group.count !== undefined)
        item.count = group.count
      const type = firstString(group.type)
      if (type !== undefined)
        item.type = type
      if (group.apipath !== undefined)
        item.apiPath = group.apipath
      out.push(item)
    }
  }

  return out
}

/**
 * 归一化 `/ajax/mblog/querygroup` 的 `data.join_groups`，按 `id` 去重。
 *
 * 纯函数；`name` 为空时退回 `system_name`，两者都为空则保留空串（仍可用 id 标识）。
 */
export function normalizeMblogGroups(raw: MblogGroupsResponse): MblogGroup[] {
  const out: MblogGroup[] = []
  const seen = new Set<string>()

  for (const group of raw.data.join_groups) {
    const id = firstString(group.id)
    if (id === undefined || seen.has(id))
      continue
    seen.add(id)

    const item: MblogGroup = {
      id,
      name: firstString(group.name, group.system_name) ?? '',
    }
    if (group.system_name !== undefined)
      item.systemName = group.system_name
    if (group.page_objectid !== undefined)
      item.pageObjectId = group.page_objectid
    out.push(item)
  }

  return out
}
