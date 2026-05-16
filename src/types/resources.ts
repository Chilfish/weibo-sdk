import type { FavoritesResponse } from '../services/endpoints/favorite'
import type { FollowContentResponse, FriendshipsResponse } from '../services/endpoints/follow'
import type { SearchTweetsResponse, SearchUsersResponse } from '../services/endpoints/search'
import type { BandUnifiedResponse } from '../services/endpoints/side'
import type { BuildCommentsResponse, FriendstimelineResponse, LongtextResponse, MyMblogResponse, SearchProfileResponse, StatusShowResponse } from '../services/endpoints/tweet'
import type { UserDetailsResponse, UserInfoResponse } from '../services/endpoints/user'

export interface IResource {
  USER_INFO: UserInfoResponse
  USER_DETAILS: UserDetailsResponse
  TWEET_MYMBLOG: MyMblogResponse
  TWEET_SHOW: StatusShowResponse
  TWEET_LONGTEXT: LongtextResponse
  TWEET_SEARCHPROFILE: SearchProfileResponse
  TWEET_COMMENTS: BuildCommentsResponse
  TWEET_FRIENDTIMELINE: FriendstimelineResponse
  SIDE_BANDUNIFIED: BandUnifiedResponse
  FAVORITES_ALLFAV: FavoritesResponse
  SEARCH_USERS: SearchUsersResponse
  SEARCH_TWEETS: SearchTweetsResponse
  FRIENDSHIPS_FRIENDS: FriendshipsResponse
  PROFILE_FOLLOWCONTENT: FollowContentResponse
}

export type IResourceType = keyof IResource
