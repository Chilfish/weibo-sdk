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
  /** 图片评论的图片数量（无图时缺省 / 0） */
  pic_num?: number
  /** 图片评论的短链列表（每张图一个 `http://t.cn/...`） */
  mix_media_ids?: string[]
  /** 图片评论的图片卡片；配图在 `pic_infos` 里 */
  url_struct?: CommentUrlStruct[]
  /** 图片评论的媒体（历史字段；当前 web 端点用 `url_struct[].pic_infos`） */
  pic?: CommentPic
  [key: string]: unknown
}

export interface CommentUrlStruct {
  url_title?: string
  short_url?: string
  long_url?: string
  ori_url?: string
  h5_target_url?: string
  pic_ids?: string[]
  /** key = 图片 id，value = 各尺寸 URL（thumbnail / bmiddle / large / woriginal ...） */
  pic_infos?: Record<string, Record<string, unknown>>
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
