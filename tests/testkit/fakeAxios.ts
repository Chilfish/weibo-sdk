import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import { axiosTransport } from '~/services/internal/transport'

export type FakeAxiosHandler = (config: AxiosRequestConfig) => Promise<unknown>

export function createFakeAxios(handler: FakeAxiosHandler): {
  client: AxiosInstance
  transport: ReturnType<typeof axiosTransport>
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

  return { client, transport: axiosTransport({ client }), getLastConfig: () => lastConfig }
}

export class NoopRateLimitService {
  async acquire(): Promise<void> {}
}
