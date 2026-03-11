/**
 * 用户性别枚举
 */
export enum Gender {
  Male = 'm',
  Female = 'f',
  Unknown = 'n',
}

export enum VerificationType {
  /** 个人认证 */
  Personal = 1,
  /** 企业认证 */
  Enterprise = 2,
  /** 人民日报等社媒认证 */
  Media = 3,
  /** 明星 */
  Celebrity = 7,
}

/**
 * 用户验证信息
 */
export interface IUserVerification {
  isVerified: boolean
  type: VerificationType
  reason?: string
}

/**
 * 核心用户领域模型
 */
export interface IUser {
  // 基础身份信息
  id: string
  name: string
  avatar: string // 对应 avatar_hd 或 avatar_large
  cover?: string
  url: string
  description?: string
  birthday?: string
  realName?: string

  // 社交属性
  location?: string
  gender: Gender
  createdAt?: string

  // 认证与等级
  verification: IUserVerification

  // 计数器 (原子数据)
  stats: {
    followers: number
    friends: number
    statuses: number
  }

  // 企业/详情扩展 (可选)
  company?: string
  creditLevel?: string // 对应 sunshine_credit.level
  externalLinks?: Array<{ title: string, url: string }>
  school?: string
}
