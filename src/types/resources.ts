import type { MyCommentsResponse } from '../services/endpoints/commentHistory'
import type { FavoritesResponse, FavoritesTagsResponse } from '../services/endpoints/favorite'
import type { FollowContentResponse, FriendshipsResponse } from '../services/endpoints/follow'
import type { FeedGroupsResponse, MblogGroupsResponse } from '../services/endpoints/groups'
import type { LikeListResponse } from '../services/endpoints/like'
import type { LikersResponse } from '../services/endpoints/likers'
import type { AlbumDetailResponse, ImageWallResponse, WaterfallResponse } from '../services/endpoints/media'
import type { MentionsViewResponse } from '../services/endpoints/mentions'
import type { MobileContainerResponse } from '../services/endpoints/mobile'
import type { MessageAttitudesResponse, MessageCommentsResponse } from '../services/endpoints/notifications'
import type { SearchTweetsResponse, SearchUsersResponse } from '../services/endpoints/search'
import type { BandUnifiedResponse } from '../services/endpoints/side'
import type { STopicCatesResponse, STopicListResponse } from '../services/endpoints/topic'
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
  PROFILE_IMAGE_WALL: ImageWallResponse
  PROFILE_WATERFALL: WaterfallResponse
  PROFILE_ALBUM_DETAIL: AlbumDetailResponse
  TWEET_LIKERS: LikersResponse
  FEED_GROUPS: FeedGroupsResponse
  MBLOG_GROUPS: MblogGroupsResponse
  MENTIONS_STATUSES: MentionsViewResponse
  MESSAGE_COMMENTS: MessageCommentsResponse
  MESSAGE_ATTITUDES: MessageAttitudesResponse
  SEARCH_USERS: SearchUsersResponse
  SEARCH_TWEETS: SearchTweetsResponse
  // m 站通用容器（guest 第一页读取：用户时间线 / 点赞 / 关注 / 粉丝）
  MOBILE_CONTAINER: MobileContainerResponse
  FRIENDSHIPS_FRIENDS: FriendshipsResponse
  PROFILE_FOLLOWCONTENT: FollowContentResponse
  STOPIC_CATES: STopicCatesResponse
  STOPIC_LIST: STopicListResponse
}

export type IResourceType = keyof IResource
