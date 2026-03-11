import type { IMyMBlogResponse } from './raw/tweet/mymblog'
import type { IUserDetailsResponse } from './raw/user/Details'
import type { IUserInfoResponse } from './raw/user/Info'

export interface IResource {
  USER_INFO: IUserInfoResponse
  USER_DETAILS: IUserDetailsResponse
  TWEET_MYMBLOG: IMyMBlogResponse
}

export type IResourceType = keyof IResource
