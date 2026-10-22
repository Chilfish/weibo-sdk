/** 微博公测起始日；未指定 `--since` 时的默认下界。 */
export const WEIBO_EPOCH = '2009-08-14'

/** 切片 journal 的格式标识；结构变化时递增。 */
export const JOURNAL_SCHEMA = 'weibo-user-archive-journal/v2'

export const DEFAULT_CONCURRENCY = 6
export const MAX_CONCURRENCY = 16
export const DEFAULT_SLICE_DAYS = 30
export const DEFAULT_DELAY_MS = 1000
export const DEFAULT_BURST = 3
export const MAX_BURST = 32

export const DAY_SECONDS = 24 * 60 * 60

/** 继续跑其他切片没有意义、必须整体停止的错误码。 */
export const FATAL_CODES: ReadonlySet<string> = new Set([
  'AUTH_SESSION_EXPIRED',
  'CONFIG_INVALID',
  'RATE_LIMITED',
])
