// src/index.ts
import pkg from '../package.json' with { type: 'json' }

export const VERSION = pkg.version

export * from './models/data'
export * from './models/errors'
export * from './types'
export * from './WeiboSDK'
