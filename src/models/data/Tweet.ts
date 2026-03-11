import type { ITweet, TweetUser } from '~/types/domain/ITweet'
import type { VerificationType } from '~/types/domain/IUser'
import type { MyMBLog } from '~/types/raw/tweet/mymblog'
import { TweetVisible } from '~/types/domain/ITweet'

export class Tweet implements ITweet {
  public createdAt: string
  public id: string
  public mblogId: string
  public media: []
  public source: string
  public stats: { likes: number, comments: number, reposts: number }
  public text: string
  public textHtml: string
  public user: TweetUser
  public visible: TweetVisible
  public regionName?: string

  constructor(raw: MyMBLog) {
    this.id = String(raw.idstr || raw.id)
    this.mblogId = raw.mblogid
    this.createdAt = raw.created_at

    this.text = raw.text_raw || ''
    this.textHtml = raw.text || ''
    this.regionName = raw.region_name || undefined

    this.source = String(raw.source || '')

    this.user = {
      id: String(raw.user.idstr || raw.user.id),
      name: raw.user.screen_name || '',
      avatar: raw.user.avatar_hd || raw.user.avatar_large || raw.user.profile_image_url || '',
      verified: !!raw.user.verified,
      verifiedType: (raw.user.verified_type ?? 0) as unknown as VerificationType,
    }

    this.stats = {
      likes: Number(raw.attitudes_count ?? 0),
      comments: Number(raw.comments_count ?? 0),
      reposts: Number(raw.reposts_count ?? 0),
    }

    const visibleType = Number(raw.visible?.type ?? 0)
    this.visible = (Object.values(TweetVisible).includes(visibleType as any)
      ? visibleType
      : TweetVisible.PUBLIC) as TweetVisible

    this.media = []
  }
}
