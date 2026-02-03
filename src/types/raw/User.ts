// src/types/raw/User.ts
export interface IUserRawResponse {
  id: number
  idstr: string
  screen_name: string
  name?: string
  profile_image_url?: string
  avatar_large?: string
  description?: string
  verified?: boolean
  verified_type?: number
  verified_reason?: string
  followers_count?: number
  friends_count?: number
  statuses_count?: number
  profile_url?: string
  location?: string
  gender?: string
  created_at?: string
  [key: string]: unknown
}
