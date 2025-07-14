import type { Plugin } from '@weibo-sdk/core'
import type { WeiboUser } from './types'

/**
 * Create user task plugin for crawling Weibo user information
 * This plugin coordinates fetcher and mapper to retrieve and process user data
 *
 * @param config Plugin configuration
 * @returns Plugin instance
 */
export function userTask(): Plugin {
  return {
    name: 'task:user',
    async setup(context) {
      const logger = context.getLogger(this.name)

      const fetcher = context.apis.get('fetcher')
      const mapUser = context.apis.get('mapper:user')

      /**
       * Get user profile information
       */
      const getUserProfile = async (userId: string): Promise<WeiboUser> => {
        logger.info('Fetching user profile', { userId })

        try {
          // Step 1: Fetch raw data using fetcher
          const endpoint = '/api/container/getIndex'

          const params = new URLSearchParams({
            type: 'uid',
            value: userId,
            containerid: `100505${userId}`,
          })

          const rawData = await fetcher(`${endpoint}?${params.toString()}`)

          logger.debug('Raw user data fetched', {
            userId,
            hasData: !!rawData,
            hasUserInfo: !!(rawData?.data?.userInfo || rawData?.userInfo),
          })

          // Step 2: Transform data using mapper
          const user = mapUser(rawData.data || rawData)

          // Step 4: Apply custom transformer if provided
          const finalUser = await context.hooks.waterfall('transform:user', user)

          logger.info('User profile processed successfully', {
            userId: finalUser.id,
            screenName: finalUser.screen_name,
            name: finalUser.name,
          })

          context.hooks.call('onData', {
            type: 'user',
            data: finalUser,
          })

          return finalUser
        }
        catch (error: any) {
          logger.error('Failed to get user profile', { userId, error: error.message })
          throw error
        }
      }

      // Register main task (for crawler.run())
      context.apis.register('task:main', async (params: any) => {
        return await getUserProfile(params?.userId)
      })
    },
  }
}
