export interface IUserDetailsResponse {
  data: Data
  ok: number
}

interface Data {
  sunshine_credit: SunshineCredit
  birthday: string
  created_at: string
  description: string
  gender: string
  ip_location: string
  hometown: string
  real_name: RealName
  followers: Followers
  label_desc: LabelDesc[]
  desc_text: string
  verified_url: string
  friend_info: string
}

interface SunshineCredit {
  level: string
}

interface RealName {
  name: string
  career: string
}

interface Followers {
  total_number: number
  users: User[]
}

interface User {
  screen_name: string
  avatar_large: string
  id: number
}

interface LabelDesc {
  name: string
  normal_mode: NormalMode
  dark_mode: DarkMode
  scheme_url: string
}

interface NormalMode {
  word_color: string
  background_color: string
}

interface DarkMode {
  word_color: string
  background_color: string
}
