import type { MyCommentsResponse } from '../services/endpoints/commentHistory'
import type { FavoritesResponse, FavoritesTagsResponse } from '../services/endpoints/favorite'
import type { FollowContentResponse, FriendshipsResponse } from '../services/endpoints/follow'
import type { LikeListResponse } from '../services/endpoints/like'
import type { SearchTweetsResponse, SearchUsersResponse } from '../services/endpoints/search'
import type { BandUnifiedResponse } from '../services/endpoints/side'
import type { BuildCommentsResponse, FriendstimelineResponse, LongtextResponse, MyMblogResponse, RepostTimelineResponse, SearchProfileResponse, StatusShowResponse } from '../services/endpoints/tweet'
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
  TWEET_REPOST_TIMELINE: RepostTimelineResponse
  SIDE_BANDUNIFIED: BandUnifiedResponse
  FAVORITES_ALLFAV: FavoritesResponse
  FAVORITES_TAGS: FavoritesTagsResponse
  LIKES_LIST: LikeListResponse
  COMMENTS_MINE: MyCommentsResponse
  SEARCH_USERS: SearchUsersResponse
  SEARCH_TWEETS: SearchTweetsResponse
  FRIENDSHIPS_FRIENDS: FriendshipsResponse
  PROFILE_FOLLOWCONTENT: FollowContentResponse
}

export type IResourceType = keyof IResource
