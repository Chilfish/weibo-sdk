import type { ITweet, ITweetComment } from '../domain/ITweet'
import type { IUser } from '../domain/IUser'

/**
 * 归档文件格式标识（与包版本解耦，见 `schemas/weibo-user-archive/v2.json`）。
 */
export const ARCHIVE_SCHEMA_ID = 'weibo-user-archive/v2'

/**
 * 归档 JSON Schema 的 canonical URL（GitHub raw）。
 *
 * 该地址同时用于归档文件的 `$schema` 字段与 schema 文档的 `$id`，
 * v2 内保持稳定；破坏性变更时新增 `v3.json`。
 */
export const ARCHIVE_SCHEMA_URL
  = 'https://raw.githubusercontent.com/Chilfish/weibo-sdk/main/schemas/weibo-user-archive/v2.json'

export type ArchiveIssueStage
  = | 'timeline'
    | 'detail'
    | 'comments'
    | 'replies'
    | 'reposts'

export interface ArchiveIssue {
  stage: ArchiveIssueStage
  mblogId?: string
  commentId?: string
  code: string
  level?: string
  retryable?: boolean
  message: string
  context?: Record<string, unknown>
}

export interface ArchivedTweet {
  mblogId: string
  source: 'timeline'
  /**
   * statuses/show 归一化结果；详情拉取失败时退回时间线里的简版。
   *
   * `statuses/show` 默认带 `isGetLongText=true`，长微博全文已在 `tweet.text`。
   */
  tweet: ITweet
  /** 一级评论；楼中楼在 comment.replies */
  comments: ITweetComment[]
  /** --reposts 时拉取的转发列表 */
  reposts?: ITweet[]
}

/**
 * `weibo-user-archive/v2` 归档文件信封。
 *
 * 字段契约与 JSON Schema（`schemas/weibo-user-archive/v2.json`）保持一致：
 * v2 内只允许新增 optional 字段，读取方需忽略未知键。
 */
export interface ArchiveFile {
  /** 归档 JSON Schema 地址；供编辑器 / 校验器自动发现 */
  $schema: string
  /** 归档格式标识 */
  schema: string
  generatedAt: string
  /** 是否完整结束（枚举未中止且没有遗留 issue） */
  complete: boolean
  query: {
    uid: string
    range: {
      since: { input: string, unix: number, iso: string }
      until: { input: string, unix: number, iso: string }
    }
    includeComments: boolean
    includeReplies: boolean
    includeReposts: boolean
    commentOrder: 'time' | 'hot'
  }
  user: IUser
  stats: {
    tweets: number
    comments: number
    replies: number
    errors: number
  }
  tweets: ArchivedTweet[]
  errors: ArchiveIssue[]
}
