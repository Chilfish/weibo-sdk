/**
 * @weibo-sdk/weibo - Weibo user crawling task plugin
 *
 * This package provides a task plugin for crawling Weibo user information,
 * coordinating fetcher and mapper plugins to retrieve and process user data.
 */

import { userTask } from './user-task'

export * from './types'
export * from './user-task'

export { userTask as default } from './user-task'

export const taskPlugins = [
  userTask(),
]
