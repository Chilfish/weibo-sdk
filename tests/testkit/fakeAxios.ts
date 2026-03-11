import type { AxiosInstance, AxiosRequestConfig } from 'axios'

export type FakeAxiosHandler = (config: AxiosRequestConfig) => Promise<unknown>

export function createFakeAxios(handler: FakeAxiosHandler): {
  client: AxiosInstance
  getLastConfig: () => AxiosRequestConfig | undefined
} {
  let interceptor: ((config: any) => any) | undefined
  let lastConfig: AxiosRequestConfig | undefined

  const client: AxiosInstance = {
    interceptors: {
      request: {
        use(fn: any) {
          interceptor = fn
          return 0
        },
      },
      response: {
        use() {
          return 0
        },
        eject() {},
        clear() {},
      } as any,
    } as any,
    async request(config: any) {
      const finalConfig = interceptor ? interceptor(config) : config
      lastConfig = finalConfig
      const data = await handler(finalConfig)
      return { data } as any
    },
  } as any

  return { client, getLastConfig: () => lastConfig }
}

export class NoopRateLimitService {
  async acquire(): Promise<void> {}
}
