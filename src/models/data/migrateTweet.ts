import type { ITweet } from '~/types/domain/ITweet'

type UnknownRecord = Record<string, unknown>

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
