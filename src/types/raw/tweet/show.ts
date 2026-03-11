export interface IStatusShowVisible {
  type: number
  list_id: number
  [key: string]: unknown
}

export interface IStatusShowUser {
  id: number
  idstr: string
  screen_name: string
  profile_image_url?: string
  profile_url?: string
  verified?: boolean
  verified_type?: number
  domain?: string
  weihao?: string
  avatar_large?: string
  avatar_hd?: string
  [key: string]: unknown
}

/**
 * `GET https://weibo.com/ajax/statuses/show?id=${mblogid}&isGetLongText=true`
 *
 * Note: 上游字段存在漂移风险；该 Raw Contract 只保证最小核心字段稳定，
 * 其余字段通过开放 Schema (`[key: string]: unknown`) 向下游暴露。
 */
export interface IStatusShowResponse {
  ok: number
  visible: IStatusShowVisible
  created_at: string
  id: number
  idstr: string
  mid?: string
  mblogid: string
  user: IStatusShowUser
  text: string
  text_raw: string

  source?: string
  region_name?: string

  attitudes_count?: number
  comments_count?: number
  reposts_count?: number

  pic_ids?: string[]
  pic_infos?: Record<string, unknown>
  mix_media_info?: Record<string, unknown>
  page_info?: Record<string, unknown>
  geo?: Record<string, unknown>
  tag_struct?: unknown[]

  retweeted_status?: IStatusShowResponse

  [key: string]: unknown
}
