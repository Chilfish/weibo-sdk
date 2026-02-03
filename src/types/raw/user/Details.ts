export interface IUserDetailsResponse {
  data: IRawUserDetails
  ok: number
}

export interface IRawUserDetails {
  sunshine_credit: SunshineCredit
  education: {
    school: string
  }
  real_name?: {
    name: string
    career: string
  }
  career?: Career
  company?: string
  birthday?: string
  created_at: string
  description: string
  gender: string
  ip_location: string
  real_name: RealName
  followers: Followers
  label_desc: LabelDesc[]
  desc_text: string
  verified_url: string
  friend_info: string
  links: Link[]
}

interface Career {
  company: string
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
  normal_mode: Mode
  dark_mode: Mode
  scheme_url: string
}

interface Mode {
  word_color: string
  background_color: string
}

interface Link {
  url: string
  title: string
}

interface RealName {
  name: string
  career: string
}

interface SunshineCredit {
  level: string
}
