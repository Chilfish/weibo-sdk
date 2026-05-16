import type { MyMblogResponse, StatusShowResponse } from '../services/endpoints/tweet'
import type { UserDetailsResponse, UserInfoResponse } from '../services/endpoints/user'
import type { ISearchTweetsResponse, ISearchUsersResponse } from './raw/search/search'

export interface IResource {
  USER_INFO: UserInfoResponse
  USER_DETAILS: UserDetailsResponse
  TWEET_MYMBLOG: MyMblogResponse
  TWEET_SHOW: StatusShowResponse
  SEARCH_USERS: ISearchUsersResponse
  SEARCH_TWEETS: ISearchTweetsResponse
}

export type IResourceType = keyof IResource
