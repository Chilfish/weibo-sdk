import type { UserDetailsResponse, UserInfoResponse } from '~/services/endpoints/user'
import type { Gender, ISelfProfile, IUser, IUserLabel, IUserVerification, UserBrief, VerificationType } from '~/types/domain/IUser'
import { parseSessionUid } from '~/utils/sessionUid'

type RawUserInfo = UserInfoResponse['data']['user']
type RawUserDetails = UserDetailsResponse['data']

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '')
      return value
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value)
  }
  return undefined
}

/**
 * 解析计数：接受 number、数字字符串与 m 站缩写（`27089` / `2.7万` / `1.2亿`）。
 *
 * 无法解析时返回 `undefined`，由调用方决定是否补 0。
 */
export function parseCompactCount(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string')
    return undefined

  const match = /^(\d+(?:\.\d+)?)\s*(万|亿)?$/.exec(value.trim())
  if (!match)
    return undefined
  const base = Number(match[1])
  if (!Number.isFinite(base))
    return undefined
  if (match[2] === '万')
    return Math.round(base * 10_000)
  if (match[2] === '亿')
    return Math.round(base * 100_000_000)
  return base
}

function toGender(value: unknown): Gender {
  if (value === 'm')
    return 'm' as Gender
  if (value === 'f')
    return 'f' as Gender
  return 'n' as Gender
}

function normalizeProfileUrl(profileUrl: string | undefined, id: string): string {
  if (profileUrl) {
    if (/^https?:\/\//.test(profileUrl))
      return profileUrl
    return `https://weibo.com${profileUrl.startsWith('/') ? '' : '/'}${profileUrl}`
  }
  return id ? `https://weibo.com/u/${id}` : ''
}

/**
 * 归一化用户简版（`friendships.users[]` / `followContent` / m 站容器 / 搜索卡片）。
 *
 * 纯函数；id 缺失时返回空串，由服务层过滤。计数缺失按 0 处理，与 `IUser.stats` 一致。
 */
export function normalizeUserBrief(raw: unknown): UserBrief {
  const record = isRecord(raw) ? raw : {}
  const id = firstText(record.idstr, record.id) ?? ''
  const user: UserBrief = {
    id,
    name: firstText(record.screen_name, record.name) ?? '',
    avatar: firstText(record.avatar_hd, record.avatar_large, record.profile_image_url) ?? '',
    url: normalizeProfileUrl(firstText(record.profile_url), id),
    gender: toGender(record.gender),
    stats: {
      followers: parseCompactCount(record.followers_count) ?? 0,
      friends: parseCompactCount(record.friends_count ?? record.follow_count) ?? 0,
      statuses: parseCompactCount(record.statuses_count) ?? 0,
    },
    verified: record.verified === true,
    verifiedType: (typeof record.verified_type === 'number' ? record.verified_type : -1) as VerificationType,
  }

  const description = firstText(record.description)
  if (description)
    user.description = description
  const location = firstText(record.location)
  if (location)
    user.location = location
  const verifiedReason = firstText(record.verified_reason)
  if (verifiedReason)
    user.verifiedReason = verifiedReason
  if (typeof record.following === 'boolean')
    user.following = record.following
  if (typeof record.follow_me === 'boolean')
    user.followedBy = record.follow_me

  return user
}

/**
 * 归一化当前登录账号资料（`ajax/profile/detail` 不带 uid 的响应）。
 *
 * 纯函数；只映射该端点实际下发的字段，缺失即缺省。
 */
export function normalizeSelfProfile(details: RawUserDetails): ISelfProfile {
  const profile: ISelfProfile = {
    gender: toGender(details.gender),
    links: (details.links ?? []).map(link => ({
      title: link.title ?? '',
      url: link.url ?? '',
    })),
  }

  const uid = parseSessionUid(details)
  if (uid)
    profile.uid = uid
  if (details.created_at)
    profile.createdAt = details.created_at
  const description = details.desc_text || details.description
  if (description)
    profile.description = description
  const ipLocation = details.ip_location?.replace('IP属地：', '')
  if (ipLocation)
    profile.ipLocation = ipLocation
  if (details.birthday)
    profile.birthday = details.birthday
  if (details.education?.school)
    profile.school = details.education.school
  if (details.sunshine_credit?.level)
    profile.creditLevel = details.sunshine_credit.level
  if (typeof details.followers?.total_number === 'number')
    profile.followers = details.followers.total_number
  const labelDesc = normalizeLabelDesc(details.label_desc)
  if (labelDesc)
    profile.labelDesc = labelDesc
  const realName = details.real_name?.name?.replace('姓名：', '')
  if (realName)
    profile.realName = realName
  const company = details.company || details.career?.company
  if (company)
    profile.company = company
  const hometown = details.hometown?.trim().replace(/^家乡：/, '')
  if (hometown)
    profile.hometown = hometown

  return profile
}

function normalizeLabelDesc(labels: RawUserDetails['label_desc']): IUserLabel[] | undefined {
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
        wordColor: label.normal_mode.word_color ?? '',
        backgroundColor: label.normal_mode.background_color ?? '',
      }
    }
    if (label.dark_mode) {
      item.darkMode = {
        wordColor: label.dark_mode.word_color ?? '',
        backgroundColor: label.dark_mode.background_color ?? '',
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
  constructor(userInfo: RawUserInfo, userDetails: RawUserDetails) {
    this.id = String(userInfo.idstr || userInfo.id)
    this.name = userInfo.screen_name || ''
    this.avatar = userInfo.avatar_hd || userInfo.avatar_large || userInfo.profile_image_url || ''
    this.cover = userInfo.cover_image_phone ?? ''
    this.url = `https://weibo.com${userInfo.profile_url || ''}`
    this.description = userInfo.description || userDetails.desc_text || ''

    this.location = userDetails.ip_location?.replace('IP属地：', '') || userInfo.location || ''
    this.gender = (userInfo.gender || userDetails.gender || 'n') as Gender
    this.createdAt = userDetails.created_at ?? ''

    this.birthday = userDetails.birthday || undefined
    this.realName = userDetails.real_name?.name?.replace('姓名：', '')

    this.verification = {
      isVerified: userInfo.verified ?? false,
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
      title: l.title ?? '',
      url: l.url ?? '',
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
