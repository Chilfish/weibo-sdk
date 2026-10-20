import type { Gender, IUser, IUserLabel, IUserVerification } from '~/types/domain/IUser'
import type { IRawUserDetails } from '~/types/raw/user/Details'
import type { IRawUserInfo } from '~/types/raw/user/Info'

function normalizeLabelDesc(labels: IRawUserDetails['label_desc'] | undefined): IUserLabel[] | undefined {
  if (!Array.isArray(labels) || labels.length === 0)
    return undefined

  const out: IUserLabel[] = []
  for (const label of labels) {
    if (!label || typeof label.name !== 'string' || label.name.length === 0)
      continue
    const item: IUserLabel = { name: label.name }
    if (typeof label.scheme_url === 'string' && label.scheme_url.length > 0)
      item.schemeUrl = label.scheme_url
    if (label.normal_mode) {
      item.normalMode = {
        wordColor: label.normal_mode.word_color,
        backgroundColor: label.normal_mode.background_color,
      }
    }
    if (label.dark_mode) {
      item.darkMode = {
        wordColor: label.dark_mode.word_color,
        backgroundColor: label.dark_mode.background_color,
      }
    }
    out.push(item)
  }
  return out.length > 0 ? out : undefined
}

/**
 * 用户领域模型（`IUser` 的具体实现）。
 *
 * 由两份 raw 响应（`userInfo` + `userDetails`）归一化而来，纯数据载体、不发请求：
 * 缺失字段按 fallback 链取值，无法确定的字段（如 `birthday` / `realName` / `school`）
 * 保持 `undefined`，而不是伪造默认值。
 */
export class User implements IUser {
  /** 头像 URL，fallback 链：`avatar_hd` → `avatar_large` → `profile_image_url` */
  public avatar: string
  /** 生日（raw `birthday`，如 `1990-01-01`）；未公开时为 `undefined` */
  public birthday?: string
  /** 公司（raw `company`，否则取 `career.company`） */
  public company?: string
  /** 主页封面图（raw `cover_image_phone`） */
  public cover: string
  /** 注册时间（raw `created_at` 原样字符串） */
  public createdAt: string
  /** 阳光信用等级（raw `sunshine_credit.level`，缺省为 `'0'`） */
  public creditLevel?: string
  /** 个人简介，fallback 到详情页 `desc_text` */
  public description: string
  /** 外部链接（raw `links`，仅保留 `title` / `url`） */
  public externalLinks?: Array<{ title: string, url: string }>
  /** 性别，fallback 到详情页 `gender`，仍缺省则 `Unknown`（`'n'`） */
  public gender: Gender
  /** 数字 UID 字符串（优先 `idstr`） */
  public id: string
  /** 所在地（优先详情页 `ip_location`，去掉 `IP属地：` 前缀） */
  public location: string
  /** 昵称（raw `screen_name`） */
  public name: string
  /** 实名（raw `real_name.name`，去掉 `姓名：` 前缀） */
  public realName?: string
  /** 学校（raw `education.school`） */
  public school?: string
  /** 微博会员等级（raw `svip`） */
  public svip?: number
  /** 微博会员等级（raw `mbrank`） */
  public mbrank?: number
  /** 家乡（详情页 raw `hometown`） */
  public hometown?: string
  /** 用户标签（详情页 raw `label_desc[]`） */
  public labelDesc?: IUserLabel[]
  /** 计数器（粉丝 / 关注 / 微博数），非数字按 0 处理 */
  public stats: { followers: number, friends: number, statuses: number }
  /** 主页地址；`https://weibo.com` + raw `profile_url` */
  public url: string
  /** 认证信息：是否认证、认证类型（缺省 -1）、认证说明 */
  public verification: IUserVerification

  /**
   * @param userInfo 用户简版 raw 响应（`ajax/profile/info` 的 `data.user`）
   * @param userDetails 用户详情 raw 响应（`ajax/profile/detail` 的 `data`）
   */
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
    this.externalLinks = userDetails.links?.map(l => ({
      title: l.title,
      url: l.url,
    }))
    this.school = userDetails.education?.school

    if (typeof userInfo.svip === 'number')
      this.svip = userInfo.svip
    if (typeof userInfo.mbrank === 'number')
      this.mbrank = userInfo.mbrank
    if (typeof userDetails.hometown === 'string' && userDetails.hometown.trim().length > 0)
      this.hometown = userDetails.hometown.trim().replace(/^家乡：/, '')
    this.labelDesc = normalizeLabelDesc(userDetails.label_desc)
  }
}
