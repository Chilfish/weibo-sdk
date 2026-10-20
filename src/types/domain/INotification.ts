import type { ITweet, ITweetComment, TweetUser } from './ITweet'

/**
 * 评论通知（D10，`/ajax/message/cmt`）。
 *
 * 上游每条通知同时内嵌「评论」与「被评论微博」，两者都保留：
 * `comment.parentMblogId` 可用于跳转，`tweet` 则是完整归一化微博。
 */
export interface CommentNotification {
  /** 归一化评论（与 `ITweetComment` 同构，含 `parentMblogId`） */
  comment: ITweetComment
  /** 被评论的微博（归一化模型） */
  tweet: ITweet
}

/**
 * 点赞通知（D10，`/ajax/message/attitudes`）。
 */
export interface LikeNotification {
  /** 通知 id（上游 `idStr` / `id`） */
  id: string
  /** 点赞时间（上游 `created_at` 原样字符串） */
  createdAt: string
  /** 点赞类型（实测 `heart`；上游未下发时为空串） */
  attitude: string
  /** 来源客户端（上游 `source`，可能是 HTML 片段） */
  source: string
  /** 点赞用户 */
  user: TweetUser
  /** 被点赞的微博（归一化模型） */
  tweet: ITweet
}
