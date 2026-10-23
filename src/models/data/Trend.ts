import type { TrendItem } from '~/types/domain/ITrend'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '')
      return value
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value)
  }
  return undefined
}

/**
 * 归一化热搜 / 话题 / 文娱榜条目（`bandUnified` 的 `data.realtime[]`）。
 *
 * 纯函数；`word` 为空的条目返回 `undefined`（无法展示，也无法作为稳定标识）。
 */
export function normalizeTrendItem(raw: unknown): TrendItem | undefined {
  if (!isRecord(raw))
    return undefined

  const word = firstText(raw.word)
  if (!word)
    return undefined

  const item: TrendItem = { word }
  if (typeof raw.num === 'number' && Number.isFinite(raw.num))
    item.heat = raw.num
  const category = firstText(raw.category)
  if (category)
    item.category = category
  const label = firstText(raw.label_name)
  if (label)
    item.label = label
  const icon = firstText(raw.icon_desc)
  if (icon)
    item.icon = icon
  if (typeof raw.flag === 'number' && Number.isFinite(raw.flag))
    item.flag = raw.flag
  const schemeUrl = firstText(raw.word_scheme)
  if (schemeUrl)
    item.schemeUrl = schemeUrl

  return item
}
