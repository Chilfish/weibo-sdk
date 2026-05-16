export interface IBuildCommentsResponse {
  ok: number
  filter_group: CommentFilterGroup[]
  data: CommentItem[]
  rootComment?: unknown
  total_number: number
  tip_msg?: string
  max_id: number
  trendsText?: string
}

export interface CommentFilterGroup {
  param: string
  scheme: string
  title: string
  isDefault: number
}

export interface CommentItem {
  id: number
  idstr: string
  mid: string
  created_at: string
  text: string
  text_raw: string
  source: string
  user: CommentUser
  like_counts: number
  liked: boolean
  floor_number: number
  comments: CommentItem[]
  total_number: number
  max_id: number
  rootid: number
  rootidstr: string
  /** 图片评论的媒体 */
  pic?: CommentPic
  [key: string]: unknown
}

export interface CommentUser {
  id: number
  idstr: string
  screen_name: string
  profile_image_url: string
  avatar_large?: string
  avatar_hd?: string
  verified?: boolean
  verified_type?: number
  [key: string]: unknown
}

export interface CommentPic {
  pid: string
  url: string
  [key: string]: unknown
}
