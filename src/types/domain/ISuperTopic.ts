/**
 * 超话分类（D7，`/ajax/stopic/cates`）。
 */
export interface SuperTopicCategory {
  /** 分类 id（作为 `/ajax/stopic/list` 的 `sort_id`） */
  id: number
  /** 分类名称（如「最近使用」「游戏」） */
  name: string
}

/**
 * 超话条目（D7，`/ajax/stopic/list` 的 `data[]`）。
 *
 * 字段按真实响应归一化；封面 / 图标为临时 URL。
 */
export interface SuperTopic {
  /** 超话 page id（`100808...`） */
  pageId: string
  /** 超话标题 */
  title: string
  /** 简介（可能包含粉丝数等长文本） */
  description?: string
  /** 封面图 */
  coverUrl?: string
  /** 列表图标 */
  icon?: string
  /** 是否为圆桌 / 圈子形态（上游 `is_circle === 1`） */
  isCircle: boolean
}
