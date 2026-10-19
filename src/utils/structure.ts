/**
 * 结构快照工具（ADR-011）：把可变值替换为类型占位符，只保留响应结构。
 *
 * 用于 E2E 快照（tests/e2e/*）与 ArchiveService 的上游漂移检测（A7）。
 * 规则：对象保留全部 key；数组只保留第一个元素（避免列表长度/内容导致噪声）；
 * 原始值按类型归一化为 `<STR>` / `<NUM>` / `<BOOL>` / `null`。
 * 这样字段新增/删除、字段类型变化会改变快照，单纯的值变化不会。
 *
 * 纯函数，不依赖类实例。
 */
export function stripVolatileKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined)
    return null
  if (Array.isArray(obj))
    return obj.length > 0 ? [stripVolatileKeys(obj[0])] : []
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(record))
      out[k] = stripVolatileKeys(v)
    return out
  }
  if (typeof obj === 'string')
    return '<STR>'
  if (typeof obj === 'number')
    return '<NUM>'
  if (typeof obj === 'boolean')
    return '<BOOL>'
  return obj
}
