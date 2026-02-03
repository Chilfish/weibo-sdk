// src/models/errors/WeiboSDKError.ts
export abstract class WeiboSDKError extends Error {
  abstract readonly code: string
  abstract readonly level: 'transport' | 'protocol' | 'business'
  abstract readonly retryable: boolean

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = this.constructor.name

    // 确保原型链正确 (对于低版本环境很有必要)
    Object.setPrototypeOf(this, WeiboSDKError.prototype)
  }
}
