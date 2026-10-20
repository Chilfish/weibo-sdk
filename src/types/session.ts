import type { UserDetailsResponse } from '../services/endpoints/user'

/**
 * 当前登录会话上下文：按 SDK 实例缓存，首次解析后复用。
 *
 * 来源是启动自检（lazy / eager）已经发出的 `ajax/profile/detail` 请求，
 * 因此不会为「取 uid」额外消耗一次上游请求。
 */
export interface WeiboSessionContext {
  /**
   * 登录账号 uid。
   *
   * 从 `data.verified_url` 中的 `uid=` 解析；上游未返回该字段时为 `undefined`。
   */
  uid?: string
  /** `ajax/profile/detail` 的原始（schema 校验后）响应 */
  details: UserDetailsResponse
  /** 解析时间（unix 毫秒） */
  checkedAt: number
}
