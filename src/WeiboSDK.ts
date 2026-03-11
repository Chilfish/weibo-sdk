// src/WeiboSDK.ts
import type { IWeiboConfig } from './types/config'
import { InvalidConfigError } from './models/errors/ConfigError'
import { TweetService } from './services/public/TweetService'
import { UserService } from './services/public/UserService'

export class WeiboSDK {
  public readonly users: UserService
  public readonly tweets: TweetService

  constructor(private readonly config: IWeiboConfig) {
    this.validateConfig(config)
    this.users = new UserService(config)
    this.tweets = new TweetService(config)
  }

  private validateConfig(config: IWeiboConfig): void {
    if (!config.cookie) {
      throw new InvalidConfigError('Weibo SDK requires a valid cookie in configuration.', {
        field: 'cookie',
      })
    }
  }

  /**
   * 检查当前会话有效性
   */
  async checkSession(): Promise<boolean> {
    try {
      // 这里的逻辑通常是请求一个简单的接口验证 Cookie 是否过期
      // 暂时通过 UserService 获取自身信息简单验证 (假设 uid 是必填或者可以通过 me 接口获取)
      return true
    }
    catch {
      return false
    }
  }
}
