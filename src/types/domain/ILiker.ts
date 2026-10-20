import type { TweetUser } from './ITweet'

/**
 * 微博点赞者（D8）。
 *
 * 上游点赞记录本身只比用户多 `created_at` / `source` 两个字段，
 * 因此这里直接继承简版用户信息，避免下游再从嵌套对象里取一次。
 *
 * `likedAt` 是上游原样时间字符串（m 站常为「5分钟前」这类相对时间），
 * SDK 不做相对时间解析，保持原样。
 */
export interface TweetLiker extends TweetUser {
  /** 点赞时间（上游 `created_at` 原样字符串） */
  likedAt?: string
  /** 点赞来源客户端（上游 `source`） */
  source?: string
}
