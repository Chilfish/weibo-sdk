export type { FavoritesResponse } from '../services/endpoints/favorite'
export type { FollowContentResponse, FriendshipsResponse } from '../services/endpoints/follow'
export type { SearchTweetsResponse, SearchUsersResponse } from '../services/endpoints/search'
export type { BandUnifiedResponse } from '../services/endpoints/side'
export type { BuildCommentsResponse, FriendstimelineResponse, LongtextResponse, MyMblogResponse, SearchProfileResponse, StatusShowResponse } from '../services/endpoints/tweet'
// src/types/index.ts
// Endpoint 响应类型（zod-inferred，服务的实际返回类型）
export type { UserDetailsResponse, UserInfoResponse } from '../services/endpoints/user'

export * from './config'
export * from './domain/ITweet'
export * from './domain/IUser'
export * from './hooks'

// 历史 raw 接口（保留向后兼容；新代码优先使用上述 endpoint 响应类型）
export type { IMyMBlogResponse } from './raw/tweet/mymblog'
export type { IStatusShowResponse } from './raw/tweet/show'
export type { IUserDetailsResponse } from './raw/user/Details'
export type { IUserInfoResponse } from './raw/user/Info'
export * from './resources'
export * from './telemetry'
