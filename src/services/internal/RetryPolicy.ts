// src/services/internal/RetryPolicy.ts
import type { IWeiboRetryConfig, WeiboRetryKind } from '~/types/config'
import { ConnectionTimeoutError, NetworkRequestError, RateLimitError } from '~/models/errors/TransportError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'

/**
 * 归一化后的重试策略（`config.retry` 的运行时形态）。
 *
 * 解析时已做边界裁剪：`retries` 落在 `[0, MAX_RETRIES]`，延迟均为有限非负数。
 */
export interface IResolvedRetryPolicy {
  /** 最大重试次数（不含首次请求） */
  retries: number
  /** 指数退避起点（毫秒） */
  baseDelayMs: number
  /** 单次重试延迟上限（毫秒） */
  maxDelayMs: number
  /** 允许重试的失败类别 */
  retryOn: readonly WeiboRetryKind[]
}

/** 默认重试策略：2 次重试、500ms 起步、单次上限 8s、覆盖全部可重试类别。 */
export const DEFAULT_RETRY_POLICY: IResolvedRetryPolicy = {
  retries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  retryOn: ['rate_limit', 'server_error', 'timeout', 'network_error'],
}

/**
 * 重试次数硬上限。
 *
 * 用于兜住 `retries: Number.POSITIVE_INFINITY` / 超大值这类配置，避免变成无限重试。
 */
export const MAX_RETRIES = 10

const ALL_RETRY_KINDS: readonly WeiboRetryKind[] = [
  'rate_limit',
  'server_error',
  'timeout',
  'network_error',
]

function toFiniteMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return fallback
  return value
}

function isRetryKind(value: unknown): value is WeiboRetryKind {
  return typeof value === 'string' && (ALL_RETRY_KINDS as readonly string[]).includes(value)
}

/**
 * 把用户配置归一化为完整策略。
 *
 * 所有字段可选且向后兼容：不传 `retry` 时使用 `DEFAULT_RETRY_POLICY`。
 */
export function resolveRetryPolicy(config?: IWeiboRetryConfig): IResolvedRetryPolicy {
  const rawRetries = config?.retries
  const retries = typeof rawRetries === 'number' && !Number.isNaN(rawRetries)
    ? Math.min(MAX_RETRIES, Math.max(0, Math.floor(rawRetries)))
    : DEFAULT_RETRY_POLICY.retries
  const baseDelayMs = toFiniteMs(config?.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs)
  const maxDelayMs = Math.max(baseDelayMs, toFiniteMs(config?.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs))
  const retryOn = Array.isArray(config?.retryOn)
    ? config.retryOn.filter(isRetryKind)
    : DEFAULT_RETRY_POLICY.retryOn.slice()

  return { retries, baseDelayMs, maxDelayMs, retryOn }
}

/**
 * 把结构化错误归类为可重试类别；不可重试（或非结构化错误）返回 `undefined`。
 *
 * 分类只依赖错误类型与 HTTP 状态码，不做文案匹配：
 * - `RateLimitError`（432 / 429）→ `rate_limit`
 * - `ConnectionTimeoutError` → `timeout`
 * - `NetworkRequestError` 且 `status >= 500` → `server_error`
 * - `NetworkRequestError` 且无 `status`（DNS / 连接重置）→ `network_error`
 * - 其余（4xx、`API_NOT_OK`、`API_BAD_RESPONSE`、`CONFIG_INVALID`…）→ `undefined`
 */
export function classifyRetryableError(error: unknown): WeiboRetryKind | undefined {
  if (error instanceof RateLimitError)
    return 'rate_limit'
  if (error instanceof ConnectionTimeoutError)
    return 'timeout'
  if (error instanceof NetworkRequestError) {
    const status = error.context?.status
    if (typeof status !== 'number')
      return 'network_error'
    return status >= 500 ? 'server_error' : undefined
  }
  return undefined
}

/**
 * 解析 `Retry-After` 响应头（支持秒数或 HTTP date），返回毫秒数。
 *
 * 无法解析 / 已过期时返回 `undefined`，交由指数退避决定延迟。
 *
 * @param value 响应头原始值（axios 可能给出 `string` / `string[]` / number）
 * @param nowMs 当前时间（毫秒时间戳），用于 HTTP date 求差；测试可注入 fake clock
 */
export function parseRetryAfter(value: unknown, nowMs: number): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw === 'number')
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 1000) : undefined
  if (typeof raw !== 'string')
    return undefined

  const trimmed = raw.trim()
  if (trimmed === '')
    return undefined

  // 纯数字 = 秒数（RFC 9110 `delay-seconds`）
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number.parseFloat(trimmed)
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined
  }

  // HTTP date
  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed))
    return undefined
  const delta = parsed - nowMs
  return delta >= 0 ? Math.round(delta) : undefined
}

/**
 * 计算第 `attempt` 次失败后的重试延迟（指数退避 + jitter）。
 *
 * - 指数退避：`baseDelayMs * 2^(attempt-1)`，由 `maxDelayMs` 截断
 * - jitter：在上一步结果上乘 `0.5 + random * 0.5`（保留 50% 下界，避免退化成同步重击）
 * - `Retry-After`：存在时优先采用（不做 jitter），同样由 `maxDelayMs` 截断
 *
 * `options` 字段：
 * - `attempt`：已失败的尝试序号（1 = 首次请求失败）
 * - `retryAfterMs`：服务端要求的等待毫秒数（来自 `Retry-After`）
 * - `random`：0~1 随机源，默认 `Math.random`；测试注入固定值以获得确定延迟
 */
export function computeBackoffDelay(options: {
  attempt: number
  policy: IResolvedRetryPolicy
  retryAfterMs?: number
  random?: () => number
}): number {
  const { attempt, policy, retryAfterMs } = options
  const random = options.random ?? Math.random

  if (typeof retryAfterMs === 'number' && retryAfterMs >= 0)
    return Math.min(policy.maxDelayMs, Math.round(retryAfterMs))

  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1
  const exponential = policy.baseDelayMs * 2 ** (safeAttempt - 1)
  const capped = Math.min(policy.maxDelayMs, exponential)
  const jitterFactor = 0.5 + random01(random) * 0.5
  return Math.max(0, Math.round(capped * jitterFactor))
}

function random01(random: () => number): number {
  const value = random()
  if (!Number.isFinite(value))
    return 0.5
  return Math.min(1, Math.max(0, value))
}

/**
 * 从结构化错误里读取 `Retry-After` 解析结果（毫秒）。
 *
 * `FetcherService.mapError` 会把解析结果写入 `context.retryAfterMs`；
 * 缺失时返回 `undefined`。
 */
export function readRetryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof WeiboSDKError))
    return undefined
  const value = error.context?.retryAfterMs
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
