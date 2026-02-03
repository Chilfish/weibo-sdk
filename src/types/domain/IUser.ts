// src/types/domain/IUser.ts
export interface IUser {
  id: string
  screenName: string
  displayName?: string
  avatar?: string
  avatarLarge?: string
  description: string
  verified: boolean
  verifiedType?: number
  verifiedReason?: string
  followersCount: number
  followingCount: number
  statusesCount: number
  profileUrl: string
  location?: string
  gender: 'm' | 'f' | 'n'
  createdAt?: Date
  rawMetadata?: Record<string, unknown>
}
