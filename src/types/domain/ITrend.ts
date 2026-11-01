/**
 * 热搜 / 话题 / 文娱榜条目（`ajax/side/bandUnified` 的 `data.realtime[]`）。
 *
 * 只保留展示需要的字段；上游未下发的字段缺省，不伪造默认值。
 */
export interface TrendItem {
  /** 榜单词条 */
  word: string
  /** 展示位次（上游 `realpos`，从 1 开始；置顶 / 并列时不再等于数组下标） */
  realpos?: number
  /** 上游排名下标（`rank`，从 0 开始；语义未完全确认，原样保留） */
  rank?: number
  /** 热度值（上游 `num`） */
  heat?: number
  /** 分类（上游 `category`） */
  category?: string
  /** 标签文案（上游 `label_name`） */
  label?: string
  /** 图标说明（上游 `icon_desc`） */
  icon?: string
  /** 上游标记位（语义未确认，原样保留） */
  flag?: number
  /** 词条跳转 scheme（上游 `word_scheme`） */
  schemeUrl?: string
}
