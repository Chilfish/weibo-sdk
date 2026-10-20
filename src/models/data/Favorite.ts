type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 收藏项自带的标签字段（`favorites/all_fav` 的 `tags`）。
 *
 * 现有真实 fixture 的标签均为空数组，上游标签元素结构尚未抓包；这里不猜 schema，
 * 只在过滤时兼容常见字段名。出现真实样本后应收窄为明确的 Zod schema。
 */
const TAG_ID_KEYS = ['id', 'idstr', 'tag_id', 'tagid'] as const
const TAG_NAME_KEYS = ['name', 'tag_name', 'title', 'tag'] as const
const TAG_KEYS = [...TAG_ID_KEYS, ...TAG_NAME_KEYS]

/**
 * 判断收藏项是否带有指定标签（按 id 或名称精确匹配）。
 *
 * 匹配范围：`tags` 数组中的字符串/数字元素，以及对象元素的 `id` / `idstr` /
 * `tag_id` / `tagid` / `name` / `tag_name` / `title` / `tag` 字段。
 * 标签元素结构未抓包，因此对无法识别的元素一律返回 `false`。
 *
 * @param raw `favorites/all_fav` 的单个收藏项（未知结构）
 * @param tag 标签 id 或名称
 * @returns 命中返回 `true`
 */
export function matchesFavoriteTag(raw: unknown, tag: string | number): boolean {
  if (!isRecord(raw))
    return false

  const tags = raw.tags
  if (!Array.isArray(tags))
    return false

  const wanted = String(tag)
  return tags.some((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number')
      return String(entry) === wanted
    if (!isRecord(entry))
      return false
    return TAG_KEYS.some((key) => {
      const value = entry[key]
      return (typeof value === 'string' || typeof value === 'number') && String(value) === wanted
    })
  })
}
