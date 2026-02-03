// src/types/domain/ITweet.ts
import type { IUser } from './IUser'

export interface ITweet {
  id: string
  mid: string
  text: string // 清洗后的纯文本
  html: string // 包含超链接的原始 HTML
  createdAt: Date
  user: IUser // 发布者

  // 计数指标
  repostsCount: number
  commentsCount: number
  attitudesCount: number // 点赞数

  // 多媒体
  images?: string[]
  videoUrl?: string

  // 转发逻辑
  isRetweet: boolean
  retweetedStatus?: ITweet

  // 原始元数据（用于调试或扩展）
  rawMetadata?: Record<string, unknown>
}
