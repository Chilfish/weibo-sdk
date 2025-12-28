import type { UserConfig } from './types/core'

export * from './core/context'
export * from './core/crawler'
export * from './types/core'
export * from './types/model'

export function defineConfig(config: UserConfig): UserConfig {
  return config
}
