import type { CrawlerContext } from "~/core/context"
import type { UnifiedPost } from "./model"

// Logger 抽象，兼容 Pino / Winston
export interface Logger {
  info: ((obj: object, msg?: string) => void) & ((msg: string) => void)
  warn: ((obj: object, msg?: string) => void) & ((msg: string) => void)
  error: ((obj: object, msg?: string) => void) & ((msg: string) => void)
  debug: ((obj: object, msg?: string) => void) & ((msg: string) => void)
  child: (bindings: Record<string, any>) => Logger
}

export interface RequestOptions {
  headers?: Record<string, string>
  params?: Record<string, string | number | boolean>
  timeout?: number
  responseType?: 'json' | 'text' | 'stream' | 'arraybuffer'
}

export interface HttpResponse<T = any> {
  data: T
  status: number
  headers: Record<string, string>
}

export interface IHttpClient {
  get: <T = any>(url: string, options?: RequestOptions) => Promise<HttpResponse<T>>
  post: <T = any>(url: string, body?: any, options?: RequestOptions) => Promise<HttpResponse<T>>
  // 暴露底层实例以便做高级拦截 (如 cookie jar 插件)
  instance: any
}

// 平台特定的凭证和配置
export interface PlatformConfig {
  // 某些平台必须的 Cookie
  cookie?: string
  // 某些平台需要特定的 Referer 才能通过风控
  referer?: string
  // 某些平台需要特定的 UA (比如移动端)
  userAgent?: string
  // 自定义字段 (如 API Key)
  [key: string]: any
}

export interface UserConfig {
  logLevel?: 'debug' | 'info' | 'warn' | 'error'

  // 全局默认 UA
  userAgent?: string

  // 平台特定配置字典: key 必须与 Provider.platformName 一致
  credentials?: Record<string, PlatformConfig>

  plugins?: any[]
}

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
}


// SNS Provider 核心契约
export interface ISNSProvider {
  readonly platformName: string;

  // 能力检测
  hasCapability(capability: 'search' | 'user_feed' | 'comments'): boolean;

  // 核心读取动作
  getPost(postId: string): Promise<UnifiedPost>;

  // 流式迭代器 - 这是 SDK 易用性的关键
  getUserFeedStream(userId: string): AsyncIterableIterator<UnifiedPost>;

  getSearchStream?(keyword: string): AsyncIterableIterator<UnifiedPost>;
}

export interface IPlugin {
  name: string;
  enforce?: 'pre' | 'post';
  setup: (context: CrawlerContext) => Promise<void> | void;
}
