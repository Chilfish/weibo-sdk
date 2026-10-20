// src/index.ts
import pkg from '../package.json' with { type: 'json' }

export const VERSION = pkg.version

export * from './capabilities'
export * from './models/data'
export * from './models/errors'
export * from './types'
export * from './utils/schemaDrift'
export * from './utils/telemetryJsonl'
export * from './WeiboSDK'
