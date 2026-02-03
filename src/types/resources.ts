import type { IUserDetailsResponse } from './raw/user/Details'
import type { IUserInfoResponse } from './raw/user/Info'

export interface IResource {
  USER_INFO: IUserInfoResponse
  USER_DETAILS: IUserDetailsResponse
}

export type IResourceType = keyof IResource
