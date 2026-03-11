// src/types/config.ts
import type { WeiboSDKHooks, WeiboSDKSelfCheckMode } from './hooks'

export interface IWeiboConfig {
  cookie: string
  xsrfToken?: string
  proxyUrl?: string
  timeout?: number
  logging?: boolean
  maxConcurrent?: number
  delay?: number | ((retryCount: number) => number)

  /**
   * SDK 级别 hooks（全局 onFetched/onError/生命周期事件）
   */
  hooks?: WeiboSDKHooks

  /**
   * 构造后会话自检策略。
   *
   * - `none`: 不自检（不推荐）
   * - `lazy`: 首次发起请求前自检（默认）
   * - `eager`: new 后立即启动自检（失败不会产生未处理 Promise；错误会在后续请求前被抛出，同时触发 hooks）
   */
  selfCheck?: {
    mode?: WeiboSDKSelfCheckMode
  }
}
