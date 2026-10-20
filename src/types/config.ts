// src/types/config.ts
import type { WeiboSDKHooks, WeiboSDKSelfCheckMode } from './hooks'
import type { WeiboSDKTelemetry } from './telemetry'

/**
 * `new WeiboSDK(...)` 的构造配置。
 *
 * 只有 `cookie` 必填；其余项都有安全的默认值（超时 30s、并发 3、请求间隔 1000ms、懒自检）。
 */
export interface IWeiboConfig {
  /**
   * 微博登录 Cookie（必填）。支持三种输入：
   * - Cookie header 串（`SUB=xxx; SUBP=xxx`）
   * - Netscape Cookie 文件路径（浏览器扩展 / curl `cookies.txt`），仅 Node 环境生效
   * - 内容为 header 串的文本文件路径（可带 `Cookie:` 前缀），仅 Node 环境生效
   *
   * 文件中的非微博域名 Cookie 会被忽略；路径不存在或文件内没有可用 Cookie 时抛
   * `InvalidConfigError`。失效会在自检或 `ok !== 1` 时以结构化错误暴露。
   */
  cookie: string
  /** XSRF Token；部分 POST 端点需要，缺省时仅发送 Cookie */
  xsrfToken?: string
  /** 上游代理地址（如 `http://127.0.0.1:7890`）；仅 Node 生效，浏览器运行时忽略 */
  proxyUrl?: string
  /** 单请求超时毫秒数（默认 30000） */
  timeout?: number
  /** 是否输出调试日志（默认关闭；库入口不产生副作用日志） */
  logging?: boolean
  /** 令牌桶最大并发数（默认 3） */
  maxConcurrent?: number
  /** 请求间隔毫秒数，或按重试次数返回间隔的函数（默认 1000） */
  delay?: number | ((retryCount: number) => number)

  /**
   * SDK 级别 hooks（全局 onFetched/onError/生命周期事件）
   */
  hooks?: WeiboSDKHooks

  /**
   * SDK 级别 telemetry（Wide Events）。
   *
   * 与 hooks 不同，telemetry 只承载“可序列化的扁平 KV”，用于生产可观测性/诊断。
   */
  telemetry?: WeiboSDKTelemetry

  /**
   * 构造后会话自检策略。
   *
   * - `none`: 不自检（不推荐）
   * - `lazy`: 首次发起请求前自检（默认）
   * - `eager`: new 后立即启动自检（失败不会产生未处理 Promise；错误会在后续请求前被抛出，同时触发 hooks）
   */
  selfCheck?: {
    /** 自检模式（默认 `lazy`） */
    mode?: WeiboSDKSelfCheckMode
  }
}
