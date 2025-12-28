import type { RawWeiboDetail, RawWeiboUser } from './types/model'
import type { Actor, UniversalID, Verification } from '~/types/model'
import { WEIBO_VERIFIED_TYPE } from './constants'
import { RawWeiboUserSchema } from './types/model'

export class WeiboParser {
  /**
   * 将微博原始用户信息转换为标准 Actor 模型
   */
  public toActor(base: RawWeiboUser, detail?: RawWeiboDetail): Actor {
    // 1. 生成唯一 ID
    const universalId: UniversalID = {
      platform: 'weibo',
      originalId: base.idstr,
      uid: `weibo_${base.idstr}`,
    }

    // 2. 解析认证状态
    const verification = this.parseVerification(base)

    // 3. 构建标准 Actor
    return {
      id: universalId,
      username: base.profile_url || base.idstr, // 微博没有类似 @twitter handle 的东西，优先用个性域名
      displayName: base.screen_name,

      avatar: {
        type: 'image',
        url: base.avatar_hd || base.avatar_large || '',
        thumbnailUrl: base.avatar_large,
        aspectRatio: 1, // 头像通常是正方形
      },

      profileUrl: `https://weibo.com/u/${base.idstr}`,

      verification,

      // 4. 将无法归一化的字段放入 metadata
      metadata: {
        bio: base.description, // 标准模型其实可以加 bio，暂时放这里
        stats: {
          followers: base.followers_count,
          following: base.friends_count,
          posts: base.statuses_count,
        },
        raw_verified_reason: base.verified_reason,
        created_at: detail?.created_at, // "2010-01-01"
        vip_level: base.mbrank,
      },
    }
  }

  /**
   * 验证该数据是否符合微博用户数据结构 (Runtime Check)
   */
  public validateUser(data: unknown): RawWeiboUser {
    return RawWeiboUserSchema.parse(data)
  }

  private parseVerification(user: RawWeiboUser): Verification {
    let type: 'none' | 'personal' | 'organization' = 'none'

    if (user.verified) {
      if (user.verified_type === WEIBO_VERIFIED_TYPE.PERSONAL) {
        type = 'personal'
      }
      else if (
        [
          WEIBO_VERIFIED_TYPE.ORG_GOV,
          WEIBO_VERIFIED_TYPE.ORG_ENTERPRISE,
          WEIBO_VERIFIED_TYPE.ORG_MEDIA,
          WEIBO_VERIFIED_TYPE.ORG_CAMPUS,
        ].includes(user.verified_type)
      ) {
        type = 'organization'
      }
    }

    return {
      isVerified: user.verified,
      type,
      description: user.verified_reason,
    }
  }
}
