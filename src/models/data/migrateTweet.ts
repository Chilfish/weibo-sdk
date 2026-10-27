import type { ITweet } from '~/types/domain/ITweet'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stripTextHtml(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(stripTextHtml)
  if (value === null || typeof value !== 'object')
    return value

  const out: UnknownRecord = {}
  for (const [key, entry] of Object.entries(value as UnknownRecord)) {
    // v2 删除字段：微博、评论、楼中楼、replyTo、retweetedStatus 递归生效
    if (key === 'textHtml')
      continue
    out[key] = stripTextHtml(entry)
  }
  return out
}

/**
 * 把 v1 `ITweet` 存档记录迁移到 v2（纯函数）。
 *
 * v1 → v2 只删除 `textHtml`，其余字段原样保留；没有该字段时等价于浅拷贝。
 */
export function migrateTweetV1toV2(record: UnknownRecord): ITweet {
  return stripTextHtml(record) as ITweet
}

/** v2 顶层计数 → v3 `stats` 字段。 */
const COUNTER_FIELDS: Record<string, 'reads' | 'plays' | 'edits'> = {
  readCount: 'reads',
  playCount: 'plays',
  editCount: 'edits',
}

/** v2 顶层标记 → v3 `flags` 字段。 */
const FLAG_FIELDS: Record<string, 'pinned' | 'original'> = {
  isTop: 'pinned',
  isOriginal: 'original',
}

function migrateNode(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(migrateNode)
  if (!isRecord(value))
    return value

  const out: UnknownRecord = {}
  const counters: UnknownRecord = {}
  const flags: UnknownRecord = {}

  for (const [key, entry] of Object.entries(value)) {
    const counter = COUNTER_FIELDS[key]
    if (counter) {
      if (typeof entry === 'number')
        counters[counter] = entry
      continue
    }
    const flag = FLAG_FIELDS[key]
    if (flag) {
      if (typeof entry === 'boolean')
        flags[flag] = entry
      continue
    }
    out[key] = migrateNode(entry)
  }

  if (Object.keys(counters).length > 0)
    out.stats = { ...(isRecord(out.stats) ? out.stats : {}), ...counters }
  if (Object.keys(flags).length > 0)
    out.flags = { ...(isRecord(out.flags) ? out.flags : {}), ...flags }

  return out
}

/**
 * 把 v2 `ITweet` 存档记录迁移到 v3（纯函数）。
 *
 * v2 → v3 只做结构与命名收敛，不补新数据：
 * - `readCount` / `playCount` / `editCount` → `stats.reads` / `stats.plays` / `stats.edits`；
 * - `isTop` / `isOriginal` → `flags.pinned` / `flags.original`；
 * - 其余字段原样保留，`retweetedStatus` / `comments` / `replies` / `replyTo` 递归生效。
 */
export function migrateTweetV2toV3(record: UnknownRecord): ITweet {
  return migrateNode(record) as ITweet
}
