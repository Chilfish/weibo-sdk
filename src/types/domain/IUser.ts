/**
 * 用户性别枚举
 */
export enum Gender {
  /** 男（上游 `m`） */
  Male = 'm',
  /** 女（上游 `f`） */
  Female = 'f',
  /** 未知 / 未填写（上游 `n`） */
  Unknown = 'n',
}

/**
 * 微博认证类型（对应上游 `verified_type`；未认证为 `-1`，不在枚举内）。
 */
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
  /** 是否已认证（上游 `verified`） */
  isVerified: boolean
  /** 认证类型（上游 `verified_type`，未认证为 -1） */
  type: VerificationType
  /** 认证说明文案（如「微博知名互联网博主」） */
  reason?: string
}

/**
 * 核心用户领域模型
 *
 * 由 raw 响应归一化得到的纯数据结构（实现见 `User`）；可选字段缺失表示上游未公开该项，
 * 而不是空值默认。
 */
export interface IUser {
  // 基础身份信息
  /** 数字串用户 id（优先 `idstr`） */
  id: string
  /** 昵称 */
  name: string
  /** 头像 URL（对应 avatar_hd 或 avatar_large） */
  avatar: string
  /** 主页封面图 */
  cover?: string
  /** 主页地址（`https://weibo.com` + 上游 `profile_url`） */
  url: string
  /** 个人简介 */
  description?: string
  /** 生日（未公开时缺省） */
  birthday?: string
  /** 实名（未公开时缺省） */
  realName?: string

  // 社交属性
  /** 所在地（优先详情页 IP 属地，去掉 `IP属地：` 前缀） */
  location?: string
  /** 性别 */
  gender: Gender
  /** 注册时间（上游 `created_at` 原样字符串） */
  createdAt?: string

  // 认证与等级
  /** 认证与类型信息 */
  verification: IUserVerification

  // 计数器 (原子数据)
  /** 互动计数快照 */
  stats: {
    /** 粉丝数 */
    followers: number
    /** 关注数 */
    friends: number
    /** 微博数 */
    statuses: number
  }

  // 企业/详情扩展 (可选)
  /** 公司（详情页 `company` 或 `career.company`） */
  company?: string
  /** 阳光信用等级（对应 sunshine_credit.level，缺省为 `'0'`） */
  creditLevel?: string
  /** 外部链接（仅保留标题与地址） */
  externalLinks?: Array<{ title: string, url: string }>
  /** 学校（详情页 `education.school`） */
  school?: string
}
