// src/types/raw/Tweet.ts
import type { IUserRawResponse } from './user/Details'

export interface ITweetRawResponse {
  id: number
  idstr: string
  mid: string
  text_raw: string
  text: string
  created_at: string
  user: IUserRawResponse

  reposts_count: number
  comments_count: number
  attitudes_count: number

  pic_ids?: string[]
  pic_infos?: Record<string, {
    original: { url: string }
    large: { url: string }
  }>

  retweeted_status?: ITweetRawResponse

  [key: string]: unknown
}
