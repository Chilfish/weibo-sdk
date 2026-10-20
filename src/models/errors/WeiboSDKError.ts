// src/models/errors/WeiboSDKError.ts

/**
 * 所有结构化错误的抽象基类。
 *
 * 统一契约（下游据此做重试 / 告警 / 分类）：
 * - `code`：稳定的机器可读错误码（如 `API_NOT_OK`），**不随文案变化**
 * - `level`：错误归属层（`transport` 网络层 / `protocol` 协议校验层 / `business` 业务语义层 / `storage` 本地存储层）
 * - `retryable`：是否值得重试（仅网络类通常为 `true`）
 * - `context`：排障用的结构化上下文（endpoint / args / ok / raw 等），不含敏感 Cookie
 */
export abstract class WeiboSDKError extends Error {
  /** 稳定错误码（机器可读，用于分支判断与告警聚合）。 */
  abstract readonly code: string
  /** 错误归属层：`transport` / `protocol` / `business` / `storage`。 */
  abstract readonly level: 'transport' | 'protocol' | 'business' | 'storage'
  /** 是否可安全重试（同一请求重发可能成功）。 */
  abstract readonly retryable: boolean

  /**
   * @param message 面向人的错误文案（可含 endpoint 等诊断信息）
   * @param context 结构化上下文（进 telemetry / 日志，不要放敏感信息）
   */
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = this.constructor.name

    // 确保原型链正确 (对于低版本环境很有必要)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
