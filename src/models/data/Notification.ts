import type { RawTweet } from './Tweet'
import type { CommentNotification, LikeNotification } from '~/types/domain/INotification'
import { normalizeComment, normalizeTweet, normalizeTweetUser } from './Tweet'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 归一化评论通知（`/ajax/message/cmt` 的 `data.comments[]`）。
 *
 * 纯函数；`status`（被评论微博）缺失或不是有效微博时返回 `undefined`，
 * 由服务层跳过该条（schema 正常响应里 `status` 必存在）。
 */
export function normalizeCommentNotification(raw: unknown): CommentNotification | undefined {
  const record = isRecord(raw) ? raw : {}
  const status = record.status
  if (!isRecord(status) || typeof status.mblogid !== 'string')
    return undefined

  return {
    comment: normalizeComment(record),
    tweet: normalizeTweet(status as RawTweet),
  }
}

/**
 * 归一化点赞通知（`/ajax/message/attitudes` 的 `data.attitudes[]`）。
 *
 * 纯函数；`status` 缺失时返回 `undefined`。
 */
export function normalizeLikeNotification(raw: unknown): LikeNotification | undefined {
  const record = isRecord(raw) ? raw : {}
  const status = record.status
  if (!isRecord(status) || typeof status.mblogid !== 'string')
    return undefined

  return {
    id: text(record.idStr) || text(record.id),
    createdAt: text(record.created_at),
    attitude: text(record.attitude),
    source: text(record.source),
    user: normalizeTweetUser(record.user),
    tweet: normalizeTweet(status as RawTweet),
  }
}
