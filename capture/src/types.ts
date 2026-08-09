// capture/src/types.ts — capture SDK 公共类型定义（契约见 capture/README.md）

export type CaptureHost = 'weibo.com' | 'weibo.cn' | 'm.weibo.cn'

export interface CaptureOptions {
  /** 导航 URL（与 uid 二选一，url 优先） */
  url?: string
  /** 微博 uid，导航到个人主页（触发 profile/mymblog/friendships 等多 API） */
  uid?: string
  /** cookie 注入 domain，默认 weibo.com */
  host?: CaptureHost
  /** 监听时长（秒），默认 15 */
  seconds?: number
  /** 默认 true（headless=new）；被风控时设 false */
  headless?: boolean
  /** 落盘目录（默认不落盘）；会写入 <NN>_<path>.json + _index.json */
  outDir?: string
  /** 调试端口起点，默认 9222，自动找空闲 */
  port?: number
  /** 覆盖 .env 的 WEIBO_COOKIE */
  cookie?: string
  /** 覆盖 Chrome 可执行路径（默认 CHROME_PATH 或标准安装路径） */
  chromePath?: string
  /** 自定义请求过滤（默认 isApi） */
  filter?: (url: string) => boolean
}

export interface CaptureItem {
  /** 请求 URL */
  url: string
  /** HTTP 状态码 */
  status: number
  /** Content-Type */
  mime?: string
  /** 业务 ok 字段（undefined = 响应无 ok 字段） */
  ok?: number | boolean | string
  /** 原始响应文本 */
  body: string
  /** JSON.parse 结果（可解析时） */
  json?: unknown
  /** 落盘文件名（outDir 内相对路径） */
  file?: string
}

export interface CookieParam {
  name: string
  value: string
  domain: string
  path: string
}
