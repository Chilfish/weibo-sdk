// src/types/config.ts
import type { WeiboSDKHooks, WeiboSDKSelfCheckMode } from './hooks'
import type { WeiboSDKTelemetry } from './telemetry'

/**
 * 可重试失败类别（`config.retry.retryOn` 的取值）。
 *
 * - `rate_limit`：HTTP 432（微博风控）/ 429，见 `RateLimitError`
 * - `server_error`：HTTP 5xx，见 `NetworkRequestError`
 * - `timeout`：请求超时，见 `ConnectionTimeoutError`
 * - `network_error`：无 HTTP 响应的传输层失败（DNS / 连接重置 / 代理不可达）
 */
export type WeiboRetryKind = 'rate_limit' | 'server_error' | 'timeout' | 'network_error'

/**
 * 请求级重试策略（指数退避 + jitter）。
 *
 * 只对 `retryable` 的结构化错误生效：4xx（除 429/432）、`ok != 1`、schema 校验失败一律不重试。
 */
export interface IWeiboRetryConfig {
  /**
   * 最大重试次数（不含首次请求；`0` 表示不重试）。默认 `2`，上限 `10`。
   */
  retries?: number
  /**
   * 首次重试的基础延迟毫秒数（指数退避起点）。默认 `500`。
   *
   * 第 n 次重试延迟 ≈ `baseDelayMs * 2^(n-1)`，再叠加 jitter（50%~100%），并由 `maxDelayMs` 截断。
   */
  baseDelayMs?: number
  /** 单次重试延迟上限毫秒数（默认 `8000`），同时用于截断 `Retry-After`。 */
  maxDelayMs?: number
  /**
   * 允许重试的失败类别（默认全部：`['rate_limit', 'server_error', 'timeout', 'network_error']`）。
   *
   * 传 `[]` 等价于 `retries: 0`；不在此列表的类别即使 `retryable` 也不重试。
   */
  retryOn?: WeiboRetryKind[]
}

/**
 * 代理解析上下文（每次请求 / 每次重试都会调用一次）。
 */
export interface IProxyRequestContext {
  /** 请求 URL */
  url: string
  /** HTTP 方法（当前全部为 GET） */
  method: 'GET' | 'POST'
  /** 端点名（如 `ajax/statuses/mymblog`） */
  endpoint?: string
  /** 第几次尝试（1 = 首次请求） */
  attempt: number
  /** 请求 trace_id */
  traceId: string
}

/**
 * 动态代理提供者。
 *
 * 返回值可以是代理 URL 字符串；返回 `undefined` / `null` / `false` 表示本次直连。
 * 抛错会中断本次请求（错误不会被吞掉）。
 */
export interface IProxyProvider {
  getProxy: (context: IProxyRequestContext) => string | null | undefined | false | Promise<string | null | undefined | false>
}

/** 代理配置：静态 URL、动态 Provider，或 `false` 显式直连。 */
export type WeiboProxyInput = string | false | IProxyProvider

/**
 * `new WeiboSDK(...)` 的构造配置。
 *
 * 只有 `cookie` 必填；其余项都有安全的默认值（超时 30s、并发 3、请求间隔 1000ms、重试 2 次、懒自检）。
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
  /**
   * 上游代理：静态 URL、动态 Provider，或 `false` 显式直连（仅 Node 生效）。
   *
   * - `'http://127.0.0.1:7890'`：固定代理
   * - `{ getProxy: ctx => ... }`：按请求 / 重试动态选择代理（可返回 Promise）
   * - `false`：忽略环境变量代理，强制直连
   */
  proxy?: WeiboProxyInput
  /**
   * 上游代理地址（如 `http://127.0.0.1:7890`）；仅 Node 生效，浏览器运行时忽略。
   *
   * @deprecated 请使用 `proxy`（支持动态 Provider）。
   */
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
   * 请求级重试策略（默认 `retries: 2`，指数退避 + jitter）。
   *
   * 仅对 `RateLimitError`（432/429）/ 5xx / 超时 / 无响应网络错误生效；
   * 432 命中后会同时暂停全局令牌桶，避免并发请求继续撞墙。
   */
  retry?: IWeiboRetryConfig

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
