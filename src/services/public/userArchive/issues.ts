import type { ArchiveIssue, ArchiveIssueStage } from '~/types/archive/IArchiveFile'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'

const FATAL_CODES = new Set(['AUTH_SESSION_EXPIRED', 'CONFIG_INVALID', 'RESUME_MISMATCH', 'RATE_LIMITED'])

export function toUserArchiveIssue(
  stage: ArchiveIssueStage,
  error: unknown,
  extra?: Omit<ArchiveIssue, 'stage' | 'code' | 'message'>,
): ArchiveIssue {
  if (error instanceof WeiboSDKError) {
    return {
      stage,
      code: error.code,
      level: error.level,
      retryable: error.retryable,
      message: error.message,
      ...extra,
      ...(error.context === undefined ? {} : { context: error.context }),
    }
  }
  return {
    stage,
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    ...extra,
  }
}

export function dedupeUserArchiveIssues(issues: ArchiveIssue[]): ArchiveIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = [issue.stage, issue.mblogId, issue.commentId, issue.code, issue.message].join('|')
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

/** Cookie / 配置 / 持续限流错误继续跑其他切片没有意义，直接停止派发。 */
export function isFatalUserArchiveError(error: unknown): boolean {
  return error instanceof WeiboSDKError && FATAL_CODES.has(error.code)
}
