/**
 * `schemaDigest` 漂移报告。
 *
 * `schemaDigest` 是 `stripVolatileKeys` 生成的结构快照：对象保留 key、数组只保留首元素、
 * 原始值变成 `<STR>` / `<NUM>` / `<BOOL>` / `null`。因此对它做 diff 可以直接得到
 * 「字段新增 / 删除 / 类型变化」，而不受具体值变化影响。
 */

/** 单条结构变化。 */
export interface SchemaDiffEntry {
  /** JSONPath 风格路径（根为 `$`） */
  path: string
  /** 变化类型：新增字段 / 删除字段 / 类型变化 */
  kind: 'added' | 'removed' | 'type_changed'
  /** 变化前的类型占位（仅 `removed` / `type_changed`） */
  before?: string
  /** 变化后的类型占位（仅 `added` / `type_changed`） */
  after?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function typeLabel(value: unknown): string {
  if (value === null || value === undefined)
    return 'null'
  if (Array.isArray(value))
    return 'array'
  if (typeof value === 'object')
    return 'object'
  return String(value)
}

function joinPath(base: string, key: string): string {
  return base === '$' ? `$.${key}` : `${base}.${key}`
}

interface DiffCollector {
  added: (path: string, value: unknown) => void
  removed: (path: string, value: unknown) => void
  changed: (path: string, before: unknown, after: unknown) => void
}

function collector(entries: SchemaDiffEntry[]): DiffCollector {
  return {
    added: (path, value) => entries.push({ path, kind: 'added', after: typeLabel(value) }),
    removed: (path, value) => entries.push({ path, kind: 'removed', before: typeLabel(value) }),
    changed: (path, before, after) => entries.push({
      path,
      kind: 'type_changed',
      before: typeLabel(before),
      after: typeLabel(after),
    }),
  }
}

/**
 * 对比两个 `schemaDigest`，返回结构变化列表。
 *
 * - 对象：逐 key 比较，缺失 key 记为 added / removed；
 * - 数组：只比较首元素（与 `stripVolatileKeys` 的规则一致），路径用 `[0]`；
 * - 原始值：不同即视为类型变化（占位符只有 `<STR>` / `<NUM>` / `<BOOL>` / `null`）。
 *
 * @param before 旧结构快照
 * @param after 新结构快照
 * @param basePath 递归内部使用（默认 `$`）
 */
export function diffSchemaDigest(before: unknown, after: unknown, basePath = '$'): SchemaDiffEntry[] {
  const entries: SchemaDiffEntry[] = []
  const out = collector(entries)

  if (isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(before)) {
      if (!(key in after))
        out.removed(joinPath(basePath, key), before[key])
    }
    for (const key of Object.keys(after)) {
      if (!(key in before))
        out.added(joinPath(basePath, key), after[key])
    }
    for (const key of Object.keys(before)) {
      if (key in after)
        entries.push(...diffSchemaDigest(before[key], after[key], joinPath(basePath, key)))
    }
    return entries
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length > 0 && after.length > 0)
      entries.push(...diffSchemaDigest(before[0], after[0], `${basePath}[0]`))
    return entries
  }

  if (typeLabel(before) !== typeLabel(after) || before !== after)
    out.changed(basePath, before, after)
  return entries
}

/** 把结构变化渲染成便于人阅读的多行文本。 */
export function formatSchemaDrift(entries: SchemaDiffEntry[]): string {
  if (entries.length === 0)
    return 'No structural changes.'

  const lines = entries.map((entry) => {
    switch (entry.kind) {
      case 'added':
        return `+ ${entry.path} (${entry.after})`
      case 'removed':
        return `- ${entry.path} (${entry.before})`
      case 'type_changed':
        return `~ ${entry.path}: ${entry.before} -> ${entry.after}`
      default:
        return ''
    }
  })

  const counts = {
    added: entries.filter(entry => entry.kind === 'added').length,
    removed: entries.filter(entry => entry.kind === 'removed').length,
    changed: entries.filter(entry => entry.kind === 'type_changed').length,
  }
  return [
    `Added: ${counts.added}, Removed: ${counts.removed}, Changed: ${counts.changed}`,
    ...lines,
  ].join('\n')
}
