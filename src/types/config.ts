// src/types/config.ts
import type { WeiboSDKHooks, WeiboSDKSelfCheckMode } from './hooks'
import type { WeiboLogger } from './logging'
import type { WeiboSDKTelemetry } from './telemetry'
import type { WeiboPlugin } from '~/services/internal/plugins/types'
import type { FetchLike, WeiboTransport } from '~/services/internal/transport'

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
 * 鉴权模式。
 *
 * - `auto`（默认）：有 Cookie 用 Cookie，没有 Cookie 用访客身份；
 *   **Cookie 失效后不会静默降级到 guest**（数据完整性会变化）。
 * - `cookie`：只允许 Cookie；构造时没有 Cookie 直接抛 `CONFIG_INVALID`。
 * - `guest`：只使用访客 token，显式忽略传入的 Cookie。
 */
export type WeiboAuthMode = 'auto' | 'cookie' | 'guest'

/** 访客 token 配置。 */
export interface IWeiboGuestConfig {
  /**
   * 预置访客 Cookie（`SUB=...; SUBP=...`），用于复用外部已发放的 token。
   *
   * 提供且包含 `SUB` 时不会触发放接口。
   */
  token?: string
  /**
   * token 发放方式（默认 `mobile`）。
   *
   * - `mobile`：`visitor.passport.weibo.cn`，PC 与 m 站通用
   * - `desktop`：`passport.weibo.com/visitor/genvisitor2`，仅对 `weibo.com` 有效
   * - `auto`：移动端优先，失败后尝试桌面端
   */
  issuer?: 'mobile' | 'desktop' | 'auto'
  /** token 失效时是否自动刷新（默认 `true`）；每个请求最多刷新一次。 */
  autoRefresh?: boolean
}

/**
 * `new WeiboSDK(...)` 的构造配置。
 *
 * `cookie` 在 `auth: 'guest'` 或未提供时可省略；其余项都有安全的默认值
 * （超时 30s、并发 3、请求间隔 1000ms、重试 2 次、懒自检）。
 */
export interface IWeiboConfig {
  /**
   * 微博登录 Cookie。支持三种输入：
   * - Cookie header 串（`SUB=xxx; SUBP=xxx`）
   * - Netscape Cookie 文件路径（浏览器扩展 / curl `cookies.txt`），仅 Node 环境生效
   * - 内容为 header 串的文本文件路径（可带 `Cookie:` 前缀），仅 Node 环境生效
   *
   * 文件中的非微博域名 Cookie 会被忽略；路径不存在或文件内没有可用 Cookie 时抛
   * `InvalidConfigError`。失效会在自检或 `ok !== 1` 时以结构化错误暴露。
   *
   * `auth: 'guest'` 时可省略；`auth: 'cookie'` 时必填。
   */
  cookie?: string
  /** 鉴权模式（默认 `auto`）。 */
  auth?: WeiboAuthMode
  /** 访客 token 配置（`auth: 'guest'` / 无 Cookie 时生效）。 */
  guest?: IWeiboGuestConfig
  /** XSRF Token；部分 POST 端点需要，缺省时仅发送 Cookie */
  xsrfToken?: string
  /**
   * 上游代理：静态 URL、动态 Provider，或 `false` 显式直连（仅 Node 生效）。
   *
   * - `'http://127.0.0.1:7890'`：固定代理
   * - `{ getProxy: ctx => ... }`：按请求 / 重试动态选择代理（可返回 Promise）；媒体下载同样按 URL 调用
   * - `false`：忽略环境变量代理，强制直连
   */
  proxy?: WeiboProxyInput
  /** 单请求超时毫秒数（默认 30000） */
  timeout?: number
  /**
   * 自定义传输实现（默认 `axiosTransport()`）。
   *
   * 显式替换才改变行为；Worker / Edge / 测试替身使用 `fetchTransport()`。
   */
  transport?: WeiboTransport
  /**
   * 共享 fetch 注入点（默认 `globalThis.fetch`）。
   *
   * 当前用于访客 token 发放（`GuestTokenService`）；主 transport 仍默认 axios。
   * 想用原生 fetch 发请求时显式传 `transport: fetchTransport({ fetch })`。
   */
  fetch?: FetchLike
  /** 构造期组装的插件（可选；无插件时走 identity 快路径）。 */
  plugins?: WeiboPlugin[]
  /**
   * 令牌桶容量（burst，默认 3）。
   *
   * 决定同一瞬间最多能突发多少个请求，也即实际并发上限；它不是并发闸门，
   * 持续吞吐由 `delay` 决定。想串行化请设为 `1` 并配合 `delay`。
   */
  burst?: number
  /** 令牌补充间隔毫秒数（默认 1000），即平均每 N ms 允许一个请求 */
  delay?: number

  /**
   * 请求级重试策略（默认 `retries: 2`，指数退避 + jitter）。
   *
   * 仅对 `RateLimitError`（432/429）/ 5xx / 超时 / 无响应网络错误生效；
   * 432 命中后会同时暂停全局令牌桶，避免并发请求继续撞墙。
   */
  retry?: IWeiboRetryConfig

  /**
   * SDK 级别 hooks（全局 onRaw/onError/生命周期事件）
   */
  hooks?: WeiboSDKHooks

  /**
   * SDK 级别 telemetry（Wide Events）。
   *
   * 与 hooks 不同，telemetry 只承载“可序列化的扁平 KV”，用于生产可观测性/诊断。
   */
  telemetry?: WeiboSDKTelemetry

  /**
   * 结构化日志出口（默认关闭）。
   *
   * 未配置时不创建 sink，库入口不产生 IO / console。配置后 SDK 把已有的
   * Wide Events 与生命周期事件映射成带级别的日志记录；不会额外埋点。
   *
   * 内置实现：`createConsoleLogger()` / `createJsonlLogger()` / `createMultiLogger()`；
   * 也可以直接实现 `WeiboLogger`。详见 `website/reference/logging.md`。
   */
  logger?: WeiboLogger

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
