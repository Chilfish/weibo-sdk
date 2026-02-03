export interface IUserInfoResponse {
  ok: number
  data: Data
}

interface Data {
  user: UserInfo
  tabList: TabList[]
  blockText: string
}

interface UserInfo {
  id: number
  idstr: string
  pc_new: number
  screen_name: string
  profile_image_url: string
  profile_url: string
  verified: boolean
  verified_type: number
  domain: string
  weihao: string
  verified_type_ext: number
  status_total_counter: StatusTotalCounter
  avatar_large: string
  avatar_hd: string
  follow_me: boolean
  following: boolean
  mbrank: number
  mbtype: number
  v_plus: number
  user_ability: number
  planet_video: boolean
  verified_reason: string
  description: string
  location: string
  gender: string
  followers_count: number
  followers_count_str: string
  friends_count: number
  statuses_count: number
  url: string
  svip: number
  vvip: number
  cover_image_phone: string
  icon_list: IconList[]
  user_type: number
  is_star: string
  is_muteuser: boolean
  special_follow: boolean
}

interface StatusTotalCounter {
  total_cnt_format: string
  comment_cnt: string
  repost_cnt: string
  like_cnt: string
  total_cnt: string
}

interface IconList {
  type: string
  data: Data2
}

interface Data2 {
  mbrank: number
  mbtype: number
  svip: number
  vvip: number
}

interface TabList {
  name: string
  tabName: string
}
