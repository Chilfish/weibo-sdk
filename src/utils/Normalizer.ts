import type { IUser } from '../types/domain/IUser'
// src/utils/Normalizer.ts
import type { IUserRawResponse } from '../types/raw/User'

export class UserNormalizer {
  static normalize(raw: IUserRawResponse): IUser {
    return {
      id: String(raw.idstr || raw.id),
      screenName: raw.screen_name,
      displayName: raw.name,
      avatar: raw.profile_image_url,
      avatarLarge: raw.avatar_large,
      description: raw.description || '',
      verified: raw.verified || false,
      verifiedType: raw.verified_type,
      verifiedReason: raw.verified_reason,
      followersCount: raw.followers_count || 0,
      followingCount: raw.friends_count || 0,
      statusesCount: raw.statuses_count || 0,
      profileUrl: raw.profile_url || `https://weibo.com/u/${raw.idstr || raw.id}`,
      location: raw.location,
      gender: this.mapGender(raw.gender),
      createdAt: raw.created_at ? new Date(raw.created_at) : undefined,
      rawMetadata: this.extractUnknownFields(raw),
    }
  }

  private static mapGender(gender?: string): 'm' | 'f' | 'n' {
    if (gender === 'm')
      return 'm'
    if (gender === 'f')
      return 'f'
    return 'n'
  }

  private static extractUnknownFields(
    raw: IUserRawResponse,
  ): Record<string, unknown> {
    const knownFields = [
      'id',
      'idstr',
      'screen_name',
      'name',
      'profile_image_url',
      'avatar_large',
      'description',
      'verified',
      'verified_type',
      'verified_reason',
      'followers_count',
      'friends_count',
      'statuses_count',
      'profile_url',
      'location',
      'gender',
      'created_at',
    ]

    const unknown: Record<string, unknown> = {}
    for (const key of Object.keys(raw)) {
      if (!knownFields.includes(key)) {
        unknown[key] = raw[key]
      }
    }
    return unknown
  }
}
