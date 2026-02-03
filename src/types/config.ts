// src/types/config.ts
export interface IWeiboConfig {
  cookie: string
  xsrfToken?: string
  proxyUrl?: string
  timeout?: number
  logging?: boolean
  maxConcurrent?: number
  delay?: number | ((retryCount: number) => number)
}
