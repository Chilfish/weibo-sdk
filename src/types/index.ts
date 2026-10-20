export type {
  MyCommentItem,
  MyCommentsArgs,
  MyCommentsResponse,
} from '../services/endpoints/commentHistory'
export type {
  FavoritesResponse,
  FavoritesTagsResponse,
} from '../services/endpoints/favorite'
export type {
  FollowContentResponse,
  FriendshipsResponse,
} from '../services/endpoints/follow'
export type {
  FeedGroupsResponse,
  MblogGroupsArgs,
  MblogGroupsResponse,
} from '../services/endpoints/groups'
export type {
  LikeItem,
  LikeListArgs,
  LikeListResponse,
} from '../services/endpoints/like'
export type { LikersArgs, LikersResponse } from '../services/endpoints/likers'
export type {
  AlbumDetailResponse,
  ImageWallResponse,
  WaterfallResponse,
} from '../services/endpoints/media'
export type {
  MentionsViewArgs,
  MentionsViewResponse,
} from '../services/endpoints/mentions'
export type {
  AttitudeItem,
  MessageArgs,
  MessageAttitudesResponse,
  MessageCommentsResponse,
} from '../services/endpoints/notifications'
export type {
  SearchTweetsResponse,
  SearchUsersResponse,
} from '../services/endpoints/search'
export type { BandUnifiedResponse } from '../services/endpoints/side'
export type {
  STopicCatesResponse,
  STopicListResponse,
} from '../services/endpoints/topic'
export type {
  BuildCommentsResponse,
  FriendstimelineResponse,
  LongtextResponse,
  MyMblogResponse,
  RepostTimelineResponse,
  SearchProfileResponse,
  StatusShowResponse,
} from '../services/endpoints/tweet'
// src/types/index.ts
// Endpoint 响应类型（zod-inferred，服务的实际返回类型）
export type {
  UserDetailsResponse,
  UserInfoResponse,
} from '../services/endpoints/user'
export type {
  ArchiveCheckpoint,
  ArchiveErrorAction,
  ArchiveErrorStage,
  ArchiveIncrementalOptions,
  ArchiveItem,
  ArchiveItemErrorContext,
  ArchivePhase,
  ArchiveProgress,
  ArchiveRawMeta,
  ArchiveServiceDeps,
  ArchiveStreamOptions,
  ArchiveTimelineSource,
  ArchiveUserItem,
  ArchiveUsersOptions,
} from '../services/public/ArchiveService'
export type {
  CommentHistoryListOptions,
  CommentHistoryPageResult,
  CommentHistoryStreamOptions,
  CommentHistoryStreamProgress,
} from '../services/public/CommentHistoryService'
export type {
  FavoriteListOptions,
  FavoritePageResult,
  FavoriteStreamOptions,
  FavoriteStreamProgress,
} from '../services/public/FavoriteService'
export type {
  FollowingsSource,
  FollowingsStreamOptions,
  FollowingsStreamProgress,
} from '../services/public/FollowingsService'
export type {
  LikeListOptions,
  LikePageResult,
  LikeStreamOptions,
  LikeStreamProgress,
} from '../services/public/LikeService'
export type {
  AlbumListResult,
  AlbumPhotoListOptions,
  AlbumPhotoPageResult,
  AlbumPhotoStreamOptions,
  AlbumStreamProgress,
  ImageWallListOptions,
  ImageWallPageResult,
  ImageWallStreamOptions,
  MediaServiceDownloadDeps,
  MediaStreamProgress,
  VideoWaterfallListOptions,
  VideoWaterfallPageResult,
  VideoWaterfallStreamOptions,
} from '../services/public/MediaService'
export type {
  CommentNotificationPageResult,
  LikeNotificationPageResult,
  NotificationListOptions,
  NotificationStreamOptions,
  NotificationStreamProgress,
} from '../services/public/NotificationService'
export type {
  SuperTopicListOptions,
  SuperTopicPageResult,
  SuperTopicStreamOptions,
} from '../services/public/TopicService'
export type {
  TweetCommentsStreamOptions,
  TweetCommentsStreamProgress,
  TweetEnrichOptions,
  TweetEnrichResult,
  TweetFriendTimelineStreamOptions,
  TweetLikersOptions,
  TweetLikersPageResult,
  TweetLikersStreamOptions,
  TweetLikersStreamProgress,
  TweetRepostsStreamOptions,
  TweetRepostsStreamProgress,
  TweetUserTimelineStreamOptions,
} from '../services/public/TweetService'
export type {
  UserMentionsListOptions,
  UserMentionsPageResult,
  UserMentionsStreamOptions,
  UserMentionsStreamProgress,
} from '../services/public/UserService'
export type {
  PaginateOptions,
  PaginationPage,
  PaginationProgress,
} from '../utils/pagination'
export type {
  StreamLimitOptions,
  StreamRangeOptions,
} from '../utils/streamRange'

export * from './config'
export * from './domain/IGroup'
export * from './domain/ILiker'
export * from './domain/INotification'
export * from './domain/ISuperTopic'
export * from './domain/ITweet'
export * from './domain/IUser'
export * from './domain/IUserMediaAsset'
export * from './hooks'
export * from './media'

// 历史 raw 接口（保留向后兼容；新代码优先使用上述 endpoint 响应类型）
export type { IMyMBlogResponse } from './raw/tweet/mymblog'
export type { IStatusShowResponse } from './raw/tweet/show'
export type { IUserDetailsResponse } from './raw/user/Details'
export type { IUserInfoResponse } from './raw/user/Info'
export * from './resources'
export * from './session'
export * from './telemetry'
