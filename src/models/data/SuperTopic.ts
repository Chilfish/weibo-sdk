import type { SuperTopic, SuperTopicCategory } from '~/types/domain/ISuperTopic'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0)
    return value
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  return undefined
}

/**
 * 归一化超话分类（`/ajax/stopic/cates` 的 `data[]`）。
 */
export function normalizeSuperTopicCategory(raw: unknown): SuperTopicCategory | undefined {
  const record = isRecord(raw) ? raw : {}
  const id = typeof record.id === 'number' ? record.id : Number(record.id)
  const name = getString(record.name)
  if (!Number.isFinite(id) || id < 0 || !name)
    return undefined
  return { id, name }
}

/**
 * 归一化超话条目（`/ajax/stopic/list` 的 `data[]`）。
 *
 * `page_id` 缺失的条目跳过（无法回跳超话页）。
 */
export function normalizeSuperTopic(raw: unknown): SuperTopic | undefined {
  const record = isRecord(raw) ? raw : {}
  const pageId = getString(record.page_id)
  const title = getString(record.title)
  if (!pageId || !title)
    return undefined

  const topic: SuperTopic = {
    pageId,
    title,
    isCircle: record.is_circle === 1,
  }

  const description = getString(record.description)
  if (description)
    topic.description = description
  const coverUrl = getString(record.image)
  if (coverUrl)
    topic.coverUrl = coverUrl
  const icon = getString(record.icon)
  if (icon)
    topic.icon = icon

  return topic
}
