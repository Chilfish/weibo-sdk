import { WeiboSDKError } from './WeiboSDKError'

/**
 * 调用方配置不合法（如缺少 `cookie`、依赖未注入）。
 *
 * `context.field` 指向出问题的配置项；属于调用方错误，重试无意义（`retryable: false`）。
 */
export class InvalidConfigError extends WeiboSDKError {
  readonly code: string = 'CONFIG_INVALID'
  readonly level = 'business'
  readonly retryable = false
}

/**
 * 续跑状态（journal）与本次运行配置不一致（uid / 范围 / 切片天数 / 内容选项 / 切片计划）。
 *
 * 继承 `InvalidConfigError`，`instanceof InvalidConfigError` 仍成立；`code` 单独区分，
 * 调用方不必再从 `context.field` 反推是配置写错还是 journal 不匹配。
 * `context.mismatch` 指向具体冲突的字段。
 */
export class ResumeMismatchError extends InvalidConfigError {
  readonly code = 'RESUME_MISMATCH'
}
