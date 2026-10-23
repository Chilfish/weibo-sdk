import type { ISelfProfile } from './domain/IUser'

/**
 * 当前会话上下文：按 SDK 实例缓存，首次解析后复用。
 *
 * Cookie 模式下来源是启动自检（lazy / eager）已经发出的 `ajax/profile/detail` 请求，
 * 因此不会为「取 uid」额外消耗一次上游请求；guest 模式下只检查访客 token 可用性。
 */
export interface WeiboSessionContext {
  /** 当前鉴权模式（构造时确定）。 */
  authMode: 'cookie' | 'guest'
  /**
   * 登录账号 uid。
   *
   * 从 `data.verified_url` 中的 `uid=` 解析；guest 模式或上游未返回该字段时为 `undefined`。
   */
  uid?: string
  /** 当前登录账号的资料（`ajax/profile/detail` 归一化）；guest 模式缺省。 */
  profile?: ISelfProfile
  /** 解析时间（unix 毫秒） */
  checkedAt: number
  /** guest 模式下的 token 发放时间（unix 毫秒；不含 token 明文）。 */
  guestTokenIssuedAt?: number
}
