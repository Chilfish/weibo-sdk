import type { ArchiveFile } from './IArchiveFile'

/** `mergeArchiveFiles()` 的选项。 */
export interface MergeArchiveOptions {
  /** 合并结果的 `generatedAt`；默认当前时间，测试可注入固定值。 */
  now?: Date
}

/** `mergeArchiveFiles()` 的结果。 */
export interface MergeArchiveResult {
  /** 合并后的归档信封。 */
  file: ArchiveFile
  /** 输入归档数。 */
  inputs: number
  /** 输入记录总数（含重复）。 */
  inputTweets: number
  /** 合并去重后的条数。 */
  tweets: number
  /** 被合并掉的重复条数。 */
  deduped: number
}
