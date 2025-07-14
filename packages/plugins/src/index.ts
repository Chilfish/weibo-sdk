import { taskPlugins } from '../../weibo/src'
import { createFetcherPlugin } from './fetcher'
import { createMapperPlugin } from './mapper'

export * from './fetcher'
export * from './mapper'

export const corePlugins = [
  createFetcherPlugin(),
  createMapperPlugin(),
]

export const allPlugins = [
  ...corePlugins,
  ...taskPlugins,
]
