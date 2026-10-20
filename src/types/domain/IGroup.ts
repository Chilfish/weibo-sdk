/**
 * 关注分组（D11，`/ajax/feed/allGroups`）。
 *
 * 上游把分组按「默认分组 / 我的分组 / 订阅分组 / 我的频道」分类下发；
 * 归一化后拍平为数组，用 `category` 保留分类名。
 */
export interface UserGroup {
  /** 分组 id（上游 `gid`） */
  id: string
  /** 分组标题（上游 `title`） */
  title: string
  /** 分类标题（上游顶层 `groups[].title`，如「我的分组」） */
  category?: string
  /** 分组内微博数（上游 `count`） */
  count?: number
  /** 分组类型码（上游 `type`，可能是 string 或 number） */
  type?: string
  /** 分组时间线路径（上游 `apipath`，如 `statuses/friends/timeline`） */
  apiPath?: string
}

/**
 * 微博分组（D11，`/ajax/mblog/querygroup` 的 `data.join_groups`）。
 */
export interface MblogGroup {
  /** 分组 id（上游 `id`） */
  id: string
  /** 展示名（优先 `name`，为空时退回 `system_name`） */
  name: string
  /** 系统名（上游 `system_name`，可能被截断） */
  systemName?: string
  /** 页面对象 id（上游 `page_objectid`） */
  pageObjectId?: string
}
