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
 * 微博认证类型（对应上游 `verified_type`）。
 *
 * 映射以真实响应为准：`-1` 普通用户、`0` 个人认证（黄 V），其余多为蓝 V；
 * `200` / `220` 为达人类，`400` 为已故认证用户。
 */
export enum VerificationType {
  /** 未认证 / 普通用户 */
  Unverified = -1,
  /** 个人认证（黄 V） */
  Personal = 0,
  /** 政府机构 */
  Government = 1,
  /** 企业 */
  Enterprise = 2,
  /** 媒体 */
  Media = 3,
  /** 校园 */
  School = 4,
  /** 网站 */
  Website = 5,
  /** 应用 */
  App = 6,
  /** 团体 / 机构 */
  Organization = 7,
  /** 待审企业 */
  PendingEnterprise = 8,
  /** 微博达人 */
  Influencer = 200,
  /** 中高级达人 */
  SeniorInfluencer = 220,
  /** 已故认证用户 */
  Deceased = 400,
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
 * 用户标签（详情页 `label_desc[]`，如「微博创作者」「超话粉丝大咖」）。
 */
export interface IUserLabel {
  /** 标签文案 */
  name: string
  /** 跳转地址（上游 `scheme_url`；缺省） */
  schemeUrl?: string
  /** 浅色模式配色 */
  normalMode?: {
    wordColor: string
    backgroundColor: string
  }
  /** 深色模式配色 */
  darkMode?: {
    wordColor: string
    backgroundColor: string
  }
}

/**
 * 用户简版领域模型。
 *
 * 用于关注 / 粉丝列表与用户搜索结果：只保留列表展示和跳转需要的字段，
 * 完整资料用 `users.getById()` 返回的 `IUser`。
 */
export interface UserBrief {
  /** 数字串用户 id（优先 `idstr`） */
  id: string
  /** 昵称 */
  name: string
  /** 头像 URL */
  avatar: string
  /** 主页地址 */
  url: string
  /** 个人简介 */
  description?: string
  /** 所在地 */
  location?: string
  /** 性别 */
  gender: Gender
  /** 互动计数快照（缺失按 0 处理） */
  stats: {
    /** 粉丝数 */
    followers: number
    /** 关注数 */
    friends: number
    /** 微博数 */
    statuses: number
  }
  /** 是否已认证 */
  verified: boolean
  /** 认证类型 */
  verifiedType: VerificationType
  /** 认证说明 */
  verifiedReason?: string
  /** 当前登录用户是否关注了 TA（上游 `following`；未下发时缺省） */
  following?: boolean
  /** TA 是否关注了当前登录用户（上游 `follow_me`；未下发时缺省） */
  followedBy?: boolean
}

/**
 * 当前登录账号的资料（`/ajax/profile/detail` 不带 uid 的响应）。
 *
 * 与 `IUser` 的区别：这个端点只返回详情侧字段（IP 属地 / 教育 / 公司 / 标签），
 * 不包含昵称、头像与计数；昵称等资料请用 `users.getById()`。
 */
export interface ISelfProfile {
  /** 登录账号 uid（从上游 `verified_url` 的 `uid=` 解析；解析不到时缺省） */
  uid?: string
  /** 注册时间（上游 `created_at` 原样字符串） */
  createdAt?: string
  /** 个人简介 */
  description?: string
  /** IP 属地（去掉 `IP属地：` 前缀） */
  ipLocation?: string
  /** 性别 */
  gender: Gender
  /** 生日（未公开时缺省） */
  birthday?: string
  /** 学校 */
  school?: string
  /** 阳光信用等级 */
  creditLevel?: string
  /** 粉丝数 */
  followers?: number
  /** 用户标签 */
  labelDesc?: IUserLabel[]
  /** 外部链接 */
  links: Array<{ title: string, url: string }>
  /** 实名 */
  realName?: string
  /** 公司 */
  company?: string
  /** 家乡（去掉 `家乡：` 前缀） */
  hometown?: string
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
  /** 微博会员等级（上游 `svip`；0 = 非会员 / 未下发时缺省） */
  svip?: number
  /** 微博会员等级（上游 `mbrank`；0 = 未开通 / 未下发时缺省） */
  mbrank?: number
  /** 家乡（详情页 `hometown`；未公开时缺省） */
  hometown?: string
  /** 用户标签（详情页 `label_desc[]`；无标签时缺省） */
  labelDesc?: IUserLabel[]
}
