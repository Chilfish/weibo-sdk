export const WEIBO_BASE_URL = 'https://weibo.com/ajax'

export const FETCH_PATH = {
  PROFILE_INFO: '/profile/info',
  PROFILE_DETAIL: '/profile/detail',
  SEARCH: '/side/search',
  MY_BLOG: '/statuses/mymblog',
} as const

export const WEIBO_VERIFIED_TYPE = {
  NONE: -1,
  PERSONAL: 0,
  ORG_GOV: 1, // 政府
  ORG_ENTERPRISE: 2, // 企业
  ORG_MEDIA: 3, // 媒体
  ORG_CAMPUS: 7, // 校园
} as const
