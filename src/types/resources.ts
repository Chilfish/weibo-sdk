import type { IMyMBlogResponse } from './raw/tweet/mymblog'
import type { IStatusShowResponse } from './raw/tweet/show'
import type { IUserDetailsResponse } from './raw/user/Details'
import type { IUserInfoResponse } from './raw/user/Info'

export interface IResource {
  USER_INFO: IUserInfoResponse
  USER_DETAILS: IUserDetailsResponse
  TWEET_MYMBLOG: IMyMBlogResponse
  TWEET_SHOW: IStatusShowResponse
}

export type IResourceType = keyof IResource
