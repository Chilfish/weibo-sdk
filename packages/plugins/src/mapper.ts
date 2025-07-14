import type { ICrawlerContext, Plugin } from '@weibo-sdk/core'

/**
 * Mapper plugin configuration
 */
export interface MapperConfig {
  /** Whether to enable strict validation */
  strict?: boolean
  /** Custom field transformers */
  transformers?: Record<string, (value: any) => any>
}

/**
 * Data mapper for transforming raw API responses
 */
class DataMapper {
  private logger
  private config: MapperConfig

  constructor(config: MapperConfig, context: ICrawlerContext) {
    this.logger = context.getLogger('core:mapper')
    this.config = config
  }

  /**
   * Transform raw user data from Weibo API
   */
  public mapUser(rawData: any): any {
    this.logger.debug('Mapping user data', { userId: rawData.id })

    try {
      const userInfo = rawData.userInfo || rawData

      const mappedUser = {
        id: userInfo.id?.toString() || '',
        screen_name: userInfo.screen_name || '',
        name: userInfo.name || '',
        description: userInfo.description || '',
        profile_image_url: userInfo.profile_image_url || '',
        followers_count: Number(userInfo.followers_count) || 0,
        friends_count: Number(userInfo.friends_count) || 0,
        statuses_count: Number(userInfo.statuses_count) || 0,
        created_at: userInfo.created_at || '',
        verified: Boolean(userInfo.verified),
        location: userInfo.location || '',
        url: userInfo.url || '',
        gender: userInfo.gender || 'n',
      }

      // Apply custom transformers if provided
      if (this.config.transformers) {
        Object.entries(this.config.transformers).forEach(([field, transformer]) => {
          if (field in mappedUser) {
            mappedUser[field] = transformer(mappedUser[field])
          }
        })
      }

      this.logger.debug('User mapping completed', {
        userId: mappedUser.id,
        screenName: mappedUser.screen_name,
      })

      return mappedUser
    }
    catch (error: any) {
      this.logger.error('User mapping failed', { error: error.message, rawData })
      throw new Error(`Failed to map user data: ${error.message}`)
    }
  }

  /**
   * Validate mapped data structure
   */
  public validateUser(user: any): boolean {
    const requiredFields = ['id', 'screen_name', 'name']

    for (const field of requiredFields) {
      if (!user[field]) {
        if (this.config.strict) {
          throw new Error(`Missing required field: ${field}`)
        }
        else {
          this.logger.warn('Missing required field', { field, userId: user.id })
          return false
        }
      }
    }

    return true
  }
}

/**
 * Create mapper plugin
 * @param config Mapper configuration
 * @returns Plugin instance
 */
export function createMapperPlugin(config: MapperConfig = {}): Plugin {
  return {
    name: 'mapper',
    setup: (context) => {
      const mapper = new DataMapper(config, context)

      // Register mapper APIs
      context.apis.register('mapper:user', mapper.mapUser.bind(mapper))
      context.apis.register('mapper:validateUser', mapper.validateUser.bind(mapper))

      const logger = context.getLogger('core:mapper')
      logger.info('Mapper plugin initialized', {
        strict: config.strict || false,
        transformers: Object.keys(config.transformers || {}),
      })
    },
  }
}

/**
 * Generic data transformation utility
 */
export function createDataMapper<T>(options: {
  schema: Record<string, {
    path: string
    transform?: (value: any) => any
    required?: boolean
    defaultValue?: any
  }>
}): (data: any) => T {
  return (data: any): T => {
    const result = {} as T

    Object.entries(options.schema).forEach(([key, config]) => {
      const value = getNestedValue(data, config.path)

      if (value === undefined || value === null) {
        if (config.required) {
          throw new Error(`Missing required field: ${key}`)
        }
        if (config.defaultValue !== undefined) {
          result[key] = config.defaultValue
        }
        return
      }

      result[key] = config.transform ? config.transform(value) : value
    })

    return result
  }
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined
  }, obj)
}

export interface MapperApis {
  'mapper:user': DataMapper['mapUser']
  'mapper:validateUser': DataMapper['validateUser']
}
