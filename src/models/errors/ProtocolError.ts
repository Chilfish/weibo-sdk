import { WeiboSDKError } from './WeiboSDKError'

/**
 * 上游响应不符合预期契约：非 JSON 对象（登录页 / 风控页 / 端点下线）或 Zod schema 校验失败。
 *
 * `context` 携带 `endpoint` / `args` / `raw`（非 JSON 时截断为前 200 字符）/ `zodIssues`；
 * 属于协议层失败，同一请求重试通常仍失败（`retryable: false`）。
 */
export class UnexpectedAPIResponseError extends WeiboSDKError {
  readonly code = 'API_BAD_RESPONSE'
  readonly level = 'protocol'
  readonly retryable = false
}
