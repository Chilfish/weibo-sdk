import type { IUser } from '../types/domain/IUser'
import type { IUserInfoResponse } from '~/types/raw/user/Info'

export class UserNormalizer {
  static normalize(raw: IUserInfoResponse): IUser {
    const data = raw.data.user
    return {
      id: String(data.id),
      screenName: data.screen_name,
      displayName: data.screen_name,
      avatar: data.profile_image_url,
      avatarLarge: data.avatar_large,
      description: data.description || '',
      verified: data.verified || false,
      verifiedType: data.verified_type,
      verifiedReason: data.verified_reason,
      followersCount: data.followers_count || 0,
      followingCount: data.friends_count || 0,
      statusesCount: data.statuses_count || 0,
      profileUrl: data.profile_url || `https://weibo.com/u/${data.idstr || data.id}`,
      location: data.location,
      gender: this.mapGender(data.gender),
      createdAt: undefined,
    }
  }

  private static mapGender(gender?: string): 'm' | 'f' | 'n' {
    if (gender === 'm')
      return 'm'
    if (gender === 'f')
      return 'f'
    return 'n'
  }
}
