import type { SearchTweetsResponse, SearchUsersResponse } from '../services/endpoints/search'
import type { BandUnifiedResponse } from '../services/endpoints/side'
import type { BuildCommentsResponse, FriendstimelineResponse, MyMblogResponse, StatusShowResponse } from '../services/endpoints/tweet'
import type { UserDetailsResponse, UserInfoResponse } from '../services/endpoints/user'

export interface IResource {
  USER_INFO: UserInfoResponse
  USER_DETAILS: UserDetailsResponse
  TWEET_MYMBLOG: MyMblogResponse
  TWEET_SHOW: StatusShowResponse
  TWEET_COMMENTS: BuildCommentsResponse
  TWEET_FRIENDTIMELINE: FriendstimelineResponse
  SIDE_BANDUNIFIED: BandUnifiedResponse
  SEARCH_USERS: SearchUsersResponse
  SEARCH_TWEETS: SearchTweetsResponse
}

export type IResourceType = keyof IResource
