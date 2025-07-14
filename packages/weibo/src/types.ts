/**
 * Weibo user types and interfaces
 */

/**
 * Weibo user profile information
 */
export interface WeiboUser {
  /** User ID */
  id: string
  /** User screen name */
  screen_name: string
  /** User display name */
  name: string
  /** Profile description */
  description: string
  /** Avatar URL */
  profile_image_url: string
  /** Follower count */
  followers_count: number
  /** Following count */
  friends_count: number
  /** Total posts count */
  statuses_count: number
  /** Account creation time */
  created_at: string
  /** Whether the account is verified */
  verified: boolean
  /** User location */
  location: string
  /** User URL */
  url: string
  /** Gender: m/f/n */
  gender: 'm' | 'f' | 'n'
}

/**
 * API response wrapper
 */
export interface WeiboApiResponse<T = any> {
  /** Response data */
  data: T
  /** Success status */
  ok: boolean
  /** Error message if any */
  error?: string
}

/**
 * Weibo API configuration
 */
export interface WeiboConfig {
  /** Base API URL */
  baseURL?: string
  /** Cookie for authentication */
  cookie?: string
  /** User-Agent string */
  userAgent?: string
}
