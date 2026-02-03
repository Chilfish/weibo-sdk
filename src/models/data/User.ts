import type { Gender, IUser, IUserVerification } from '~/types/domain/IUser'
import type { IRawUserDetails } from '~/types/raw/user/Details'
import type { IRawUserInfo } from '~/types/raw/user/Info'

export class User implements IUser {
  public avatar: string
  public birthday?: string
  public company?: string
  public cover: string
  public createdAt: string
  public creditLevel?: string
  public description: string
  public externalLinks?: Array<{ title: string, url: string }>
  public gender: Gender
  public id: string
  public location: string
  public name: string
  public realName?: string
  public school?: string
  public stats: { followers: number, friends: number, statuses: number }
  public url: string
  public verification: IUserVerification

  constructor(userInfo: IRawUserInfo, userDetails: IRawUserDetails) {
    this.id = String(userInfo.idstr || userInfo.id)
    this.name = userInfo.screen_name || ''
    this.avatar = userInfo.avatar_hd || userInfo.avatar_large || userInfo.profile_image_url || ''
    this.cover = userInfo.cover_image_phone
    this.url = `https://weibo.com${userInfo.profile_url || ''}`
    this.description = userInfo.description || userDetails.desc_text

    this.location = userDetails.ip_location?.replace('IP属地：', '') || userInfo.location
    this.gender = (userInfo.gender || userDetails.gender || 'n') as Gender
    this.createdAt = userDetails.created_at

    this.birthday = userDetails.birthday || undefined
    this.realName = userDetails.real_name?.name?.replace('姓名：', '')

    this.verification = {
      isVerified: userInfo.verified,
      type: userInfo.verified_type ?? -1,
      reason: userInfo.verified_reason,
    }

    this.stats = {
      followers: Number(userInfo.followers_count ?? 0),
      friends: Number(userInfo.friends_count ?? 0),
      statuses: Number(userInfo.statuses_count ?? 0),
    }

    // 扩展属性填充
    this.company = userDetails.company || userDetails.career?.company
    this.creditLevel = userDetails.sunshine_credit?.level || '0'
    this.externalLinks = userDetails.links?.map((l: any) => ({
      title: l.title,
      url: l.url,
    }))
    this.school = userDetails.education?.school
  }
}
