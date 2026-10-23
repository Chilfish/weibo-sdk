/**
 * 收藏夹标签。
 *
 * 上游标签元素结构尚未抓包；归一化按常见键做 best-effort 映射，
 * 无法识别 id / name 的条目会被跳过。
 */
export interface FavoriteTag {
  /** 标签 id */
  id?: string
  /** 标签名称 */
  name?: string
}
