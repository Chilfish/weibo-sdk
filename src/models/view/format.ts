import { cleanTweetText, normalizeTweetDate } from './TweetContext'

/** Markdown 列表 / 卡片的公共选项。 */
export interface MarkdownListOptions {
  /** 标题（`# 标题`） */
  title: string
  /** 标题下的补充说明（分页游标、总数、采样边界等） */
  notes?: readonly string[]
  /** 单条正文摘要的字符上限（默认由各渲染器决定；`0` = 不限） */
  maxChars?: number
  /** 空列表时的文案 */
  emptyText?: string
}

/** 千分位计数（与 `tweet context` 卡片保持一致）。 */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

/** 上游 `created_at` → 带偏移的本地时间；解析失败时原样返回。 */
export function formatWhen(value: string): string {
  const { publishedAt, publishedAtLocal } = normalizeTweetDate(value)
  return publishedAtLocal ?? publishedAt
}

/** 单行摘要：去 HTML / 零宽字符 / 换行，超过 `maxChars` 截断。 */
export function summarizeText(value: string, maxChars: number): string {
  const text = cleanTweetText(value).replace(/\s*\n\s*/g, ' ').trim()
  if (!maxChars || maxChars <= 0 || text.length <= maxChars)
    return text
  return `${text.slice(0, maxChars)}…`
}

/** 列表标题 + 说明行；没有 notes 时不输出空行。 */
export function renderListHeader(options: MarkdownListOptions): string[] {
  const lines = [`# ${options.title}`, '']
  if (options.notes && options.notes.length > 0) {
    for (const note of options.notes)
      lines.push(`- ${note}`)
    lines.push('')
  }
  return lines
}

/** 把分页 / 采样信息统一渲染成标题下的说明行。 */
export function paginationNotes(input: {
  page?: number
  maxId?: string
  cursor?: number | string
  hasMore?: boolean
  total?: number
  partial?: boolean
}): string[] {
  const notes: string[] = []
  if (input.page !== undefined)
    notes.push(`下一页页码：${input.page}`)
  if (input.maxId !== undefined)
    notes.push(`下一页游标（maxId）：${input.maxId}`)
  if (input.cursor !== undefined)
    notes.push(`下一页游标：${input.cursor}`)
  if (input.hasMore !== undefined)
    notes.push(`还有更多：${input.hasMore ? '是' : '否'}`)
  if (input.total !== undefined)
    notes.push(`总数：${formatCount(input.total)}`)
  if (input.partial)
    notes.push('访客模式只取到首屏，结果不完整（partial）')
  return notes
}
